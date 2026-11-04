import React from 'react';
import ReactDOM from 'react-dom/client';
// Side-effect import, and it must come before App: the stores read
// localStorage the moment their modules evaluate.
import './lib/migrate.js';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
