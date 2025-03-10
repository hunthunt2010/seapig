/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2016 Yasumichi Akahoshi
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// Load electron modules
const electron = require('electron');
const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const localShortcut = require("electron-localshortcut");
const Menu = electron.Menu;
const ipc = require('electron').ipcMain;
const dialog = require('electron').dialog;
const shell = electron.shell;

// Load node native module
const fs = require('fs');
const path = require('path');

// Constants
const FIRST_ARG = 0;
const SECOND_ARG = 1;
const THIRD_ARG = 2;
const IDX_OFFSET = 1;
const markdownExt = /\.(md|mdwn|mkdn|mark.*|txt)$/
const W_WIDTH = 800;
const W_HEIGHT = 600;
const SHIFT = 20;

var winList = [];
var screenWidth = null;
var screenHeight = null;
var docModified = false;
var pdfWorkerWindow = null;

// Parse command line arguments
function getArguments() {
  let argv = [];
  let tmp_args = [];
  let tmp_opts = [];

  if (/^electron/.test(path.basename(process.argv[FIRST_ARG]))) {
    argv =  process.argv.slice(THIRD_ARG);
  } else {
    argv =  process.argv.slice(SECOND_ARG);
  }
  argv.forEach((element) => {
    if (/^-/.test(element) === true) {
      tmp_opts.push(element);
    } else {
      tmp_args.push(element);
    }
  });

  return  { opts: tmp_opts, args: tmp_args };
}

/**
 *  Create new window when File-New menu is clicked or CommandOrControl+N is
 * pressed.
 */
function createNewFile() {
  winList.push(createWindow());
}

/**
 *   Inform renderer process to click File-Open menu or press
 *  CommandOrControl+O.
 */
function callOpenFile() {
  let win = BrowserWindow.getFocusedWindow();
  win.webContents.send('open-menu-click');
}

/**
 *   Inform renderer process to click File-Save menu or press
 *  CommandOrControl+O.
 */
function callSaveFile() {
  let win = BrowserWindow.getFocusedWindow();
  win.webContents.send('save-menu-click');
}

/**
 *   Inform renderer process to click File-SaveAs menu.
 */
function callSaveAsFile() {
  let win = BrowserWindow.getFocusedWindow();
  win.webContents.send('saveas-menu-click');
}

/**
 *   Inform renderer process to click File-ExportAsHTML menu.
 */
function callExportAsHTML() {
  let win = BrowserWindow.getFocusedWindow();
  win.webContents.send('export-html-click');
}

/**
 *   Inform renderer process to click File-PrintToPDF menu.
 */
function callPrintToPDF() {
  let win = BrowserWindow.getFocusedWindow();
  win.webContents.send('print-pdf-click');
}

// Define menu templates
// { role: 'fileMenu'}
const fileMenu = {
  label: '&File',
  submenu: [
    {
      label: '&New',
      accelerator: 'CommandOrControl+N',
      click: createNewFile
    },
    {
      label: '&Open',
      accelerator: 'CommandOrControl+O',
      click: callOpenFile
    },
    { type: 'separator' },
    {
      label: '&Save',
      accelerator: 'CommandOrControl+S',
      click: callSaveFile
    },
    {
      label: 'Save&As',
      click: callSaveAsFile
    },
    { type: 'separator' },
    {
      label: 'Export as &HTML',
      click: callExportAsHTML
    },
    {
      label: '&Print to PDF',
      accelerator: 'CommandOrControl+P',
      click: callPrintToPDF
    },
    { type: 'separator' },
    // isMac ? { role: 'close' } : { role: 'quit' }
    { role: 'quit' }
  ]
};

// { role: 'viewMenu'}
const viewMenu = {
  label: '&View',
  submenu: [
    { role: 'toggleDevTools' },
    { type: 'separator' },
    { role: 'togglefullscreen' }
  ]
};

// { role: 'helpMenu'}
const helpMenu = {
  label: '&Help',
  submenu: [
    {
      label: '&README',
      click: async () => {
        await shell.openExternal('https://github.com/yasumichi/seapig/blob/master/README.md');
      }
    },
    {
      label: 'Search &Issues',
      click: async () => {
        await shell.openExternal('https://github.com/yasumichi/seapig/issues');
      }
    }
  ]
};

/**
 *  Create menu
 */
function createMenu() {
  const template = [
    fileMenu,
    viewMenu,
    helpMenu
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

/**
 *  Regist global shortcuts
 */
function registLocalShortcuts(win) {
  localShortcut.register(win, 'CommandOrControl+N', createNewFile);
  localShortcut.register(win, 'CommandOrControl+O', callOpenFile);
  localShortcut.register(win, 'CommandOrControl+P', callPrintToPDF);
  localShortcut.register(win, 'CommandOrControl+S', callSaveFile);
}

// Create window
function createWindow() {
  let mainWindow = null;

  // Create a instance of BrowserWindow
  mainWindow = new BrowserWindow({
    width: W_WIDTH,
    height: W_HEIGHT,
    x: winList.length * SHIFT % (screenWidth - W_WIDTH),
    y: winList.length * SHIFT % (screenHeight - W_HEIGHT),
    icon: path.join(__dirname, '../seapig.png'),
    webPreferences: {
      preload: path.join(app.getAppPath(), 'js', 'renderer.js')
    }
  });

  createMenu();

  // Load mainwindow.html
  mainWindow.loadURL(
    `file://${path.resolve(__dirname ,'../mainwindow.html')}`
  );

  // Process close request
  mainWindow.on('close', (e) => {
    var closeable = true;

    e.preventDefault();

    if (docModified === true) {
      let msg = `The document has not yet been saved.
	Are you sure you want to quit?`;
      let result = dialog.showMessageBoxSync(
	mainWindow,
	{
	  type: "info",
	  title: "SeaPig",
	  message: msg,
	  buttons: ["OK", "Cancel"]
	}
      );
      if (result === 1) {
	closeable = false;
      }
    }

    if (closeable === true) {
      mainWindow.destroy();
    }
  });

  // Destroy when window is closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (process.env.DEBUG) {
    mainWindow.toggleDevTools();
  }

  return mainWindow;
}

function getScreenSize() {
  screenWidth = electron.screen.getPrimaryDisplay().workAreaSize.width;
  screenHeight = electron.screen.getPrimaryDisplay().workAreaSize.height;
}

// Show window when app is ready.
app.on('ready', () => {
  let ignoreList = [];
  let isFile = false;
  let program = getArguments();

  getScreenSize();
  if (program.args.length) {
    program.args.forEach((element) => {
      let fullpath = element;
      if (!path.isAbsolute(element)) {
        fullpath = path.resolve(process.cwd(), element);
      }
      try {
        isFile = fs.statSync(fullpath).isFile();
      } catch (error) {
        isFile = false;
      }
      if (isFile && markdownExt.test(fullpath)) {
        let winIndex = winList.push(createWindow()) - IDX_OFFSET;
        winList[winIndex].webContents.on('did-finish-load', () => {
          registLocalShortcuts(winList[winIndex]);
          winList[winIndex].webContents.send('open-file', fullpath);
        });
      } else {
        ignoreList.push(`${fullpath} isn't  file.`);
      }
    });
  }
  if (!winList.length) {
    let winIndex = winList.push(createWindow()) - IDX_OFFSET;
    winList[winIndex].webContents.on('did-finish-load', () => {
      registLocalShortcuts(winList[winIndex]);
    });
  }
  if (ignoreList.length) {
    dialog.showMessageBox({
      title: "Warning",
      type: "warning",
      message: 'Ignore bellow arguments.',
      detail: ignoreList.join('\n'),
      buttons: ['OK']
    });
  }
})

// Cancel new window when link is clicked and open url by defualt browser.
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, url, frameName, disposition, options) => {
    if ( ! /^devtools:/.test(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  })
})

// Exit application when all window is closed.
app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
})

// getDefaultPath
function getDefaultPath(currentFile) {
  let defaultPath = "";

  if (currentFile == "") {
    defaultPath = path.join(app.getPath('documents'), 'new_file');
  } else {
    defaultPath = path.join(
      path.dirname(currentFile),
      path.basename(currentFile, path.extname(currentFile))
    );
  }

  return  defaultPath;
}

// request new file
ipc.on('new-file', () => {
  winList.push(createWindow());
});

// request open file dialog
ipc.on('open-file-dialog', (event, currentFile, isNewWindow) => {
  let options = {
    title: 'Open Markdown File',
    properties: ['openFile'],
    defaultPath: path.dirname(currentFile),
    filters: [
      {
        name: 'Markdown',
        extensions: [ 'md', 'mdwn', 'mkd', 'mkdn', 'mark*', 'txt' ]
      }
    ]
  };
  dialog.showOpenDialog(
    options
  ).then(result => {
      if (result.canceled === false) {
        let filenames = result.filePaths;
        if (isNewWindow === true) {
          let newWindow = createWindow();
          winList.push(newWindow);
          newWindow.webContents.on('did-finish-load', () => {
            newWindow.webContents.send('open-file', filenames[FIRST_ARG]);
          });
        } else {
          event.sender.send ('selected-file', filenames);
        }
      }
  }).catch(err => {
    console.log(err);
  });
});

// request save new file
ipc.on('save-new-file', (event) => {
  let options = {
    title: 'Save Markdown File',
    properties: ['openFile'],
    defaultPath: `${getDefaultPath('')}.md`,
    filters: [
      {
        name: 'Markdown',
        extensions: [ 'md' ]
      }
    ]
  };
  dialog.showSaveDialog(
      options,
      (filenames) => {
        if (filenames) event.sender.send ('selected-save-file', filenames);
      }
      );
});

// request export HTML
ipc.on('export-HTML', (event, currentFile) => {
  let options = {
    title: 'Export HTML file',
    properties: ['openFile'],
    defaultPath: `${getDefaultPath(currentFile)}.html`,
    filters: [
      { name: 'HTML', extensions: [ 'html' ] }
    ]
  };
  dialog.showSaveDialog(
      options,
      (filename) => {
        if (filename) event.sender.send ('selected-HTML-file', filename);
      }
      );
});

// request export pfd
ipc.on('export-pdf-file', (event, currentFile, contents) => {
  let options = {
    title: 'Export PDF file',
    properties: ['openFile'],
    defaultPath: `${getDefaultPath(currentFile)}.pdf`,
    filters: [
      { name: 'PDF', extensions: [ 'pdf' ] }
    ]
  };
  dialog.showSaveDialog(
      options,
      (filenames) => {
        if (filenames) {
          if(pdfWorkerWindow !== null) {
            pdfWorkerWindow.close();
          }

          pdfWorkerWindow = new BrowserWindow(
            {
              show: false,
              webPreferences: {
                preload: path.join(app.getAppPath(), 'js', 'pdfWorker.js')
              }
            }
          );
          pdfWorkerWindow.on("closed", () => {
            pdfWorkerWindow = null;
          });

          let template = path.join(app.getAppPath(), 'templates', 'template.html');
          pdfWorkerWindow.loadURL(`file://${template}`);
          pdfWorkerWindow.webContents.on("did-finish-load", () => {
            let css = `file://${path.join(app.getAppPath(), 'templates', 'github.css')}`;
            let baseHref = `file://${getDefaultPath(currentFile)}`
            pdfWorkerWindow.send("print-to-pdf", contents, baseHref, css, filenames);
          });
        }
      }
    );
});

ipc.on('ready-print-to-pdf', (event, pdfPath) => {
  const options = { printBackground: true };

  pdfWorkerWindow.webContents.printToPDF(options, (error, data) => {
    if (error) {
      throw error;
    }
    fs.writeFile(pdfPath, data, (error) => {
      if (error) {
        throw error;
      }
      shell.openItem(pdfPath);
      pdfWorkerWindow.close(); 
    });
  });
});

// request error message
ipc.on('error-message', (event, error_msg) => {
  dialog.showMessageBox({
    title: "Error",
    type: "error",
    message: error_msg,
    buttons: ['OK']
  });
});

// recieve document status
ipc.on('doc-modified', (event, modified) => {
  docModified = modified;
});
