# TalkTunnel

A cross-device text sharing tool that allows you to send text and files between your mobile device and computer.

## Features

- **Desktop app** shows a QR code with server URL
- **Mobile interface** is a PWA-enabled webpage accessible by scanning the QR code  
- **Automatic text pasting** at cursor position when nut.js works properly
- **Fallback to clipboard** mode if automatic pasting fails
- **Cross-platform support** Windows, macOS, Linux
- **File transfer** between devices
- **Real-time synchronization** via WebSocket
- **Multilingual support** (Chinese/English)

## Technology Stack

- **Electron** for the desktop application
- **Express.js** for the web server
- **Nut.js** for system automation
- **QR Code generation** for easy mobile connection
- **WebSocket** for real-time communication

## Installation

### Quick Installation

For Unix-like systems (macOS, Linux):
```bash
chmod +x install.sh
./install.sh
```

For Windows:
```cmd
install.bat
```

### Manual Installation

1. Install dependencies:
```bash
npm install
```

2. Start the application:
```bash
npm start
```

## Usage

1. **Start the application** - Run `npm start` to launch the desktop app
2. **Scan QR code** - Open the QR code displayed on your computer with your mobile device
3. **Send text** - Type text on your mobile device and it will automatically paste on your computer
4. **Transfer files** - Select files on mobile to send to your computer, or send files from computer to mobile
5. **Auto-paste settings** - Adjust delay time for automatic text pasting (0-10 seconds)

## Development

### Prerequisites

#### macOS
- Xcode command line tools: `xcode-select --install`
- **Accessibility** and **Screen Recording** permissions for the terminal/IDE
- For building Windows apps on macOS:
```bash
brew install --cask wine-stable
```

#### Linux
- X11 display server (Wayland not supported)
- libXtst library:
```bash
sudo apt-get install libxtst-dev  # Ubuntu/Debian
```

#### Windows
- Windows 10 users need Media Feature Pack for codecs/plugins
- Administrator privileges required for automatic pasting

### Building the Application

#### Available Build Commands

```bash
# Generate icons
npm run generate-icons

# Build for current platform
npm run build

# Build for specific platforms
npm run dist-mac          # macOS all architectures
npm run dist-mac-arm64     # macOS ARM (M1/M2)
npm run dist-mac-x64       # macOS Intel
npm run dist-mac-universal # macOS Universal
npm run dist-win           # Windows all architectures
npm run dist-win-x64       # Windows x64
npm run dist-win-arm64     # Windows ARM64

# Cross-platform builds
npm run build-cross-platform
npm run dist-all-platforms  # Build for Mac, Windows and Linux
npm run dist-win-only       # Build only Windows version
```

### Build Output

After building, you'll find the packaged applications in the `dist` directory:

- **macOS**:
  - `TalkTunnel.app` - Application
  - `TalkTunnel.dmg` - Installer

- **Windows**:
  - `TalkTunnel Setup.exe` - Installer  
  - `TalkTunnel.exe` - Portable Version
  - `TalkTunnel-win.zip` - ZIP Archive

- **Linux**:
  - `TalkTunnel.AppImage` - Portable
  - `TalkTunnel.deb` - Debian Package

## Troubleshooting

### Build Issues

1. **Permission Issues on macOS**
   - If building Windows apps fails, ensure Wine is installed:
   ```bash
   brew install --cask wine-stable
   ```
   - Try rebuilding and clearing cache if issues persist

2. **Native Module Compilation**
   - If you encounter native module errors:
   ```bash
   npm run rebuild
   ```

3. **Clean Build**
   - For a fresh build, remove these directories:
   ```bash
   rm -rf node_modules
   rm -rf dist
   npm install
   ```

### Permission Issues

macOS: If you see permission warnings:
1. Go to System Preferences → Security & Privacy → Privacy
2. Add your terminal/IDE to both Accessibility and Screen Recording lists

### Network Issues

- Ensure your mobile device and computer are on the same network
- Check firewall settings if the connection fails
- Default port: 3000 (automatically assigned)

### Windows Specific Issues

- For automatic pasting to work, run the application as administrator
- Use `start-windows-admin.bat` to launch with admin privileges
- If pasting fails, the text will be copied to clipboard as fallback

## Development Commands

```bash
npm start                    # Start development server
npm run generate-icons       # Generate application icons
npm run build               # Build application for current platform
npm run dist                # Build and package application
npm run rebuild             # Rebuild native modules
```

## License

MIT License - see [LICENSE](LICENSE) file for details

## Contributing

Issues and pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## Troubleshooting Disk Issues

If you encounter disk mounting issues on macOS:
```bash
hdiutil detach /Volumes/TalkTunnel 2>/dev/null || true
```


