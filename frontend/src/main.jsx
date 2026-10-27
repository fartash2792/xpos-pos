import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.jsx';
import './index.css';

if (localStorage.getItem('xpos_dark') === '1') document.documentElement.classList.add('dark');
registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
