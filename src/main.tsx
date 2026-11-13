import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { useProjectStore } from './store/useProjectStore';
import { useUpdate } from './store/updateStore';
import './styles/global.css';

// 自用工具的调试/自动化入口：便于在无头浏览器里构造大规模数据做性能验证
Object.assign(window, { __shotflow: useProjectStore, __update: useUpdate });

const root = document.getElementById('root');
if (!root) throw new Error('缺少 #root 挂载点');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
