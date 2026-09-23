const { execFile } = require('child_process');

const scripts = {
  paste: 'tell application "System Events" to keystroke "v" using command down',
  enter: 'tell application "System Events" to key code 36'
};

function sendMacKey(action) {
  if (process.platform !== 'darwin' || !scripts[action]) {
    return Promise.reject(new Error('Unsupported macOS keyboard action'));
  }

  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-e', scripts[action]], { timeout: 30000 }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

module.exports = { sendMacKey };
