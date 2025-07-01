const { exec } = require('child_process');
const path = require('path');

// Windows-specific paste helper using PowerShell
function pasteWithPowerShell(text) {
    return new Promise((resolve, reject) => {
        // Escape special characters for PowerShell
        const escapedText = text
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '`"')
            .replace(/\$/g, '`$');
        
        // PowerShell command to paste text
        const psCommand = `
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.Clipboard]::SetText("${escapedText}")
            [System.Windows.Forms.SendKeys]::SendWait("^v")
        `;
        
        exec(`powershell -Command "${psCommand}"`, (error, stdout, stderr) => {
            if (error) {
                reject(error);
            } else {
                resolve(true);
            }
        });
    });
}

module.exports = { pasteWithPowerShell }; 