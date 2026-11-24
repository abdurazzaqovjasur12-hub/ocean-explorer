import { createApp } from 'vue';
import App from '@/App.vue';
import '@/styles/main.css';

// The story always opens where the URL says (the top, or a #chapter), not where the browser last left the page.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

createApp(App).mount('#app');
