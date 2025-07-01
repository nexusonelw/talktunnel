// Renderer process script
const QRCode = require('qrcode');
const { ipcRenderer } = require('electron');

let serverInfo = null;

async function updateServerInfo() {
  try {
    serverInfo = await ipcRenderer.invoke('get-server-info');
    
    // Update UI
    document.getElementById('ipAddress').textContent = serverInfo.ip;
    document.getElementById('port').textContent = serverInfo.port;
    document.getElementById('connectedClients').textContent = serverInfo.connectedClients.length;
    
    // Generate QR code
    if (serverInfo.url) {
      const qrcodeContainer = document.getElementById('qrcode');
      qrcodeContainer.innerHTML = ''; // Clear existing QR code
      
      const canvas = document.createElement('canvas');
      qrcodeContainer.appendChild(canvas);
      
      QRCode.toCanvas(canvas, serverInfo.url, {
        width: 200,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff'
        }
      }, function (error) {
        if (error) {
          console.error('QR Code generation error:', error);
          qrcodeContainer.innerHTML = '<p style="color: red;">QR Code generation failed</p>';
        } else {
          console.log('QR Code generated successfully for URL:', serverInfo.url);
        }
      });
    } else {
      console.warn('No server URL available for QR code generation');
    }
  } catch (error) {
    console.error('Failed to get server info:', error);
  }
}

// Update server info on load
updateServerInfo();

// Update connected clients count every 5 seconds
setInterval(updateServerInfo, 5000);

// 添加最小化到托盘按钮
function addTrayButton() {
  const container = document.querySelector('.container');
  const trayBtn = document.createElement('button');
  trayBtn.textContent = tpc('minimizeToTray');
  trayBtn.className = 'file-button';
  trayBtn.style.marginTop = '10px';
  trayBtn.style.backgroundColor = '#FF9800';
  trayBtn.onclick = minimizeToTray;
  
  // 在文件上传区域后添加按钮
  const fileSection = document.querySelector('.file-upload-section');
  if (fileSection) {
    container.insertBefore(trayBtn, fileSection.nextSibling);
  } else {
    container.appendChild(trayBtn);
  }
}

function minimizeToTray() {
  const { ipcRenderer } = require('electron');
  ipcRenderer.send('minimize-to-tray');
}

// 页面加载完成后添加按钮
window.addEventListener('load', () => {
  setTimeout(addTrayButton, 1000); // 延迟添加确保其他元素已加载
});

// 处理PC端文件上传
document.getElementById('pcFileInput').addEventListener('change', async function(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  const fileInfo = document.getElementById('pcFileInfo');
  fileInfo.textContent = tpc('fileSending', file.name);
  
  const formData = new FormData();
  formData.append('file', file);
  
  try {
    const response = await fetch(`http://${serverInfo.ip}:${serverInfo.port}/send-to-phones`, {
      method: 'POST',
      body: formData
    });
    
    const result = await response.json();
    if (response.ok) {
      fileInfo.textContent = tpc('fileSentToDevices', result.clients);
      e.target.value = '';
    } else {
      fileInfo.textContent = tpc('sendFailed', result.error);
    }
  } catch (error) {
    console.error('Error sending file:', error);
    fileInfo.textContent = tpc('sendFailedRetry');
  }
});

// 处理外部链接
document.addEventListener('DOMContentLoaded', () => {
  // 拦截所有链接点击
  document.addEventListener('click', (event) => {
    // 检查是否是链接或者链接内的 SVG 元素
    const link = event.target.closest('a');
    if (link && link.href && link.href.startsWith('http')) {
      // 阻止默认行为
      event.preventDefault();
      // 通过 IPC 发送到主进程
      ipcRenderer.send('open-external-link', link.href);
    }
  });
});
