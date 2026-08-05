// 拼音输入法 - LLM 配置管理（基于 electron-store）
// 与现有 TalkTunnel 的 electron-store 实例隔离，使用独立 storeName
const Store = require('electron-store');

const pinyinStore = new Store({
  name: 'pinyin-input-config',
  defaults: {
    // OpenAI 兼容接口配置
    baseURL: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    // 唤起快捷键（Electron Accelerator 格式）
    hotkey: 'CommandOrControl+Shift+P',
    // 转换提示语温度等可选项
    temperature: 0.2
  }
});

module.exports = pinyinStore;