import { createRoot } from 'react-dom/client';
import { html } from './lib/html.js';
import { init } from './lib/store.js';
import { App } from './ui/App.js';

await init();
createRoot(document.getElementById('root')).render(html`<${App} />`);
