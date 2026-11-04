/**
 * useSongGeneration.js
 * ---------------------------------------------------------------------------
 * The bridge between the UI, the prompts, and the LLM client.
 *
 * Owns: request lifecycle, cancellation, status messages and error shaping.
 * Components call these three functions and render whatever `status` says.
 */

import { useCallback, useRef } from 'react';
import { useSettingsStore } from '../store/useSettingsStore.js';
import { toast } from '../store/useToastStore.js';
import { useSongStore } from '../store/useSongStore.js';
import { chatCompletion, listModels, isFreeModelId, LLMError } from '../lib/llmClient.js';
import { parseModelJson, normaliseSong } from '../lib/songSchema.js';
import {
  buildSystemPrompt,
  buildGeneratePrompt,
  buildFullRegeneratePrompt,
  buildSectionPrompt,
  buildJsonRepairNudge,
} from '../prompts/songPrompts.js';

/** Tell the user when we changed their model for them. */
function toastModelSwitch(from, to) {
  toast.info(`"${from}" is no longer served — switched to ${to}. Change it in Settings if you would rather pick.`);
}

/** Turn any thrown value into something worth showing a person. */
function describeError(err) {
  if (err instanceof LLMError) {
    return { message: err.message, advice: err.advice || '', kind: err.kind };
  }
  if (err?.name === 'AbortError') {
    return { message: 'Generation cancelled.', advice: '', kind: 'aborted' };
  }
  return {
    message: err?.message || 'Something went wrong.',
    advice: 'If this keeps happening, check your settings and try a different model.',
    kind: 'unknown',
  };
}

export function useSongGeneration() {
  const abortRef = useRef(null);

  const settings = useSettingsStore();
  const {
    form,
    song,
    setSong,
    setStatus,
    clearStatus,
    replaceSection,
    markSectionBusy,
    effectiveGenre,
  } = useSongStore();

  /** Cancel whatever is in flight. */
  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  /**
   * Shared request path: builds messages, streams, parses — and recovers from
   * the two ways weaker models routinely fail.
   *
   * 1. The model id has been retired. Free line-ups churn constantly, so the
   *    saved slug stops working through no fault of the user. We ask the
   *    provider what it serves now, switch to a free one, and retry.
   * 2. The model has no JSON mode and rejects response_format with a 400. We
   *    turn the setting off, remember that, and retry. The user never sees it.
   * 3. The model answers in prose, or with fenced or broken JSON that even the
   *    repair pass in songSchema.js cannot rescue. We send one short, blunt
   *    corrective message and try again.
   *
   * Each path retries at most once, so a failing request costs two calls
   * rather than looping — which matters on a free tier metered per day.
   *
   * @returns {Promise<object>} parsed JSON object from the model
   */
  const request = useCallback(
    async (userPrompt, { stage, target = null }) => {
      cancel();
      const controller = new AbortController();
      abortRef.current = controller;

      /**
       * Find a working replacement for a retired model id.
       *
       * Deliberately ignores any slug the provider suggests: that is almost
       * always the paid variant of the same model, and silently moving someone
       * onto a paid model is not ours to do.
       *
       * @returns {Promise<string|null>} a model id to try instead
       */
      const findReplacementModel = async (failedModel) => {
        const s = useSettingsStore.getState();
        try {
          const models = await listModels({ baseUrl: s.baseUrl, apiKey: s.apiKey });
          const pool = s.freeOnly ? models.filter(isFreeModelId) : models;
          const next = pool.find((m) => m !== failedModel);
          if (next) {
            s.setDiscoveredModels(models);
            return next;
          }
        } catch {
          // The listing failed too; nothing more we can do automatically.
        }
        return null;
      };

      /** One attempt. `extraMessages` carries the corrective turn on a retry. */
      const attempt = async ({ jsonMode, extraMessages = [], label }) => {
        const s = useSettingsStore.getState();
        setStatus({ state: 'generating', stage: label || stage, message: '', streamText: '', target });
        return chatCompletion({
          baseUrl: s.baseUrl,
          apiKey: s.apiKey,
          model: s.model,
          temperature: s.temperature,
          jsonMode,
          stream: s.streaming,
          maxTokens: s.maxTokens,
          signal: controller.signal,
          messages: [
            { role: 'system', content: buildSystemPrompt() },
            { role: 'user', content: userPrompt },
            ...extraMessages,
          ],
          onToken: (_chunk, full) => {
            // Surface raw progress so long generations don't look frozen.
            setStatus({ streamText: full });
          },
        });
      };

      try {
        let text;
        const useJsonMode = useSettingsStore.getState().jsonMode;

        try {
          text = await attempt({ jsonMode: useJsonMode });
        } catch (err) {
          if (!(err instanceof LLMError)) throw err;

          // Retry: the model id has been retired. Pick a live one and go again.
          if (err.modelUnavailable) {
            const failed = useSettingsStore.getState().model;
            const replacement = await findReplacementModel(failed);
            if (!replacement) {
              throw new LLMError('config', `The model "${failed}" is no longer available.`, {
                advice: err.suggestedSlug
                  ? `Your provider suggests "${err.suggestedSlug}", which is usually the paid version — set it in Settings if you are happy to pay. Otherwise press Test to see what is free right now.`
                  : 'Open Settings and press Test to load the models your key can currently reach. Free line-ups change often.',
              });
            }
            useSettingsStore.getState().set({ model: replacement });
            text = await attempt({
              jsonMode: useJsonMode,
              label: `${stage} — "${failed}" is retired, switched to ${replacement}`,
            });
            toastModelSwitch(failed, replacement);

          // Retry: this model has no JSON mode.
          } else if (err.jsonModeUnsupported && useJsonMode) {
            useSettingsStore.getState().set({ jsonMode: false });
            text = await attempt({
              jsonMode: false,
              label: `${stage} — this model has no JSON mode, retrying without it`,
            });
          } else {
            throw err;
          }
        }

        try {
          return parseModelJson(text);
        } catch (parseErr) {
          if (!(parseErr instanceof LLMError) || parseErr.kind !== 'parse') throw parseErr;

          // Retry #2: it did not send usable JSON. Correct it once, bluntly.
          const retryText = await attempt({
            jsonMode: useSettingsStore.getState().jsonMode,
            label: `${stage} — the reply was not valid JSON, asking again`,
            extraMessages: [
              { role: 'assistant', content: String(text).slice(0, 2000) },
              { role: 'user', content: buildJsonRepairNudge(text) },
            ],
          });

          try {
            return parseModelJson(retryText);
          } catch {
            // Report the original failure: it is the more informative one.
            throw new LLMError(
              'parse',
              'This model would not return usable JSON, twice.',
              {
                advice:
                  'Weaker free models often cannot hold a schema this size. Try a larger free model, lower the temperature in Settings, or simplify the structure to fewer sections.',
              },
            );
          }
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [cancel, setStatus],
  );

  // -------------------------------------------------------------------------
  // Public actions
  // -------------------------------------------------------------------------

  /** Generate a brand-new song from the form. */
  const generateSong = useCallback(async () => {
    const formWithGenre = { ...useSongStore.getState().form, genre: effectiveGenre() };
    try {
      const raw = await request(buildGeneratePrompt(formWithGenre), {
        stage: 'Writing your song',
      });
      const next = normaliseSong(raw, formWithGenre);
      setSong(next, { snapshot: true, label: 'Generated' });
      clearStatus();
      return next;
    } catch (err) {
      const info = describeError(err);
      if (info.kind === 'aborted') clearStatus();
      else setStatus({ state: 'error', ...info, streamText: '' });
      return null;
    }
  }, [request, setSong, setStatus, clearStatus, effectiveGenre]);

  /** Regenerate the whole song, preserving locked sections verbatim. */
  const regenerateAll = useCallback(async () => {
    const current = useSongStore.getState().song;
    if (!current) return null;

    const formWithGenre = { ...useSongStore.getState().form, genre: effectiveGenre() };
    const locked = current.sections
      .filter((s) => s.locked)
      .map(({ type, label, lyrics, chords, melodyContour, performanceNote }) => ({
        type, label, lyrics, chords, melodyContour, performanceNote,
      }));

    try {
      const raw = await request(buildFullRegeneratePrompt(formWithGenre, current, locked), {
        stage: locked.length
          ? `Rewriting around ${locked.length} locked section${locked.length > 1 ? 's' : ''}`
          : 'Rewriting the song',
      });
      const next = normaliseSong(raw, formWithGenre);

      // Belt and braces: re-apply locked content client-side in case the model
      // paraphrased a section it was told to keep.
      next.sections = next.sections.map((section) => {
        const lockedMatch = current.sections.find(
          (s) => s.locked && s.label.toLowerCase() === section.label.toLowerCase(),
        );
        return lockedMatch ? { ...lockedMatch, id: section.id } : section;
      });

      setSong(next, { snapshot: true, label: 'Full rewrite' });
      clearStatus();
      return next;
    } catch (err) {
      const info = describeError(err);
      if (info.kind === 'aborted') clearStatus();
      else setStatus({ state: 'error', ...info, streamText: '' });
      return null;
    }
  }, [request, setSong, setStatus, clearStatus, effectiveGenre]);

  /**
   * Regenerate or restyle a single section.
   * @param {string} sectionId
   * @param {string} [instruction] e.g. "Make it darker"
   */
  const regenerateSection = useCallback(
    async (sectionId, instruction = '') => {
      const current = useSongStore.getState().song;
      const section = current?.sections.find((s) => s.id === sectionId);
      if (!section) return null;

      const formWithGenre = { ...useSongStore.getState().form, genre: effectiveGenre() };
      markSectionBusy(sectionId, true);

      try {
        const raw = await request(
          buildSectionPrompt(formWithGenre, current, section, instruction),
          { stage: `Reworking ${section.label}`, target: sectionId },
        );
        // Snapshot before mutating so the change is undoable from History.
        useSongStore.getState().pushHistory(current, `Before: ${section.label}`);
        replaceSection(sectionId, raw.section && typeof raw.section === 'object' ? raw.section : raw);
        clearStatus();
        return true;
      } catch (err) {
        const info = describeError(err);
        if (info.kind === 'aborted') clearStatus();
        else setStatus({ state: 'error', ...info, streamText: '' });
        return null;
      } finally {
        markSectionBusy(sectionId, false);
      }
    },
    [request, replaceSection, markSectionBusy, setStatus, clearStatus, effectiveGenre],
  );

  return {
    generateSong,
    regenerateAll,
    regenerateSection,
    cancel,
    isConfigured: settings.isConfigured(),
    hasSong: Boolean(song),
    form,
  };
}
