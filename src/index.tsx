/**
 * Keet v1.1 - Entry Point
 * 
 * Privacy-first, offline-capable real-time transcription.
 */

/* @refresh reload */
import { render } from 'solid-js/web';
import '@fontsource/crimson-pro/latin-400.css';
import '@fontsource/crimson-pro/latin-500.css';
import '@fontsource/crimson-pro/latin-600.css';
import '@fontsource/crimson-pro/latin-400-italic.css';
import '@fontsource/plus-jakarta-sans/latin-300.css';
import '@fontsource/plus-jakarta-sans/latin-400.css';
import '@fontsource/plus-jakarta-sans/latin-500.css';
import '@fontsource/plus-jakarta-sans/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource-variable/material-symbols-outlined/fill.css';
import App from './App';
import './index.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

render(() => <App />, root);

