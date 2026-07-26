var loaded = false;
var toEval = [];

window.onmessage = function(e) {
  // webViewLog("webview html got message from parent " + e.data);
  // alert("Got message from parent " + e.data);
  if (e.data.startsWith("eval:")) {
    var str = e.data.substring(5);
    if (loaded) {
      // webViewLog("webview html evaluating now " + str);
      eval(str);
    } else {
      // webViewLog("webview html evaluating later " + str);
      toEval.push(str);
    }
  }
};

window.addEventListener('DOMContentLoaded', onWebviewDomContentLoaded);

function evalAll() {
  for (var i = 0; i < toEval.length; i++) {
    // webViewLog("webview html evaluating now " + toEval[i]);
    eval(toEval[i].replace(/[\t\n\r]/gm,'')); // remove linebreaks and tabs
  }
  toEval = [];
}

function onLoad() {
  // Note 20220211: Android WebView FUC (flash of unstyled content) unless we delay the display of content. No big deal since this
  // view is modal and there is a fade happening during the wait.
  setTimeout(function() {
    var c = document.getElementById('content');
    c.style.display = 'block';
    loaded = true;
    evalAll();
    window.addEventListener('resize', function() {
      layoutContent();
    });
  }, 100);
  // webViewLog("webview html onLoad()");
  // webViewLog("webview html evaluated count " + toEval.length);
}

function layoutContent() {
  var iw = window.innerWidth;
  var ih = window.innerHeight;
  var c = document.getElementById('content');
  var b = document.getElementById('body');
  b.style.paddingTop = iw > ih ? "0.3em" : "3em";
  var widthPx = Math.min(Math.max(iw * widthFraction, minWidth), maxWidth);
  var fontSize = "12px";
  if (ih > sizeLimit18 && iw > sizeLimit18) {
    fontSize = "18px";
  } else if (ih > sizeLimit16 && iw > sizeLimit16) {
    fontSize = "16px";
  } else if (ih > sizeLimit14 && iw > sizeLimit14) {
    fontSize = "14px";
  } else if (ih < sizeLimit8Inv || iw < sizeLimit8Inv) {
    fontSize = "8px";
  }
  // console.log(fontSize, iw);
  b.style.fontSize = fontSize;
  c.style.width = widthPx + "px";
}

function onWebviewDomContentLoaded() {
  layoutContent();
}


function webViewPostMessage(m) {
  // alert('posting message ' + m);

  if (typeof Fancade !== "undefined" && Fancade.webViewPostMessage) {
    Fancade.webViewPostMessage(m); // Android
  } else if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.fancadeHandler) {
    window.webkit.messageHandlers.fancadeHandler.postMessage(m); // iOS or MacOS
  } else if (window.parent !== window) { // Inside an iframe
    window.parent.postMessage(m, '*');
  } else if (window.chrome && window.chrome.webview) { // Windows
    window.chrome.webview.postMessage(m);
  }
  else {
    // alert("Could not post message '" + m + "'' to native");
  }
}
function webViewError(type, message) {
  webViewPostMessage('error|' + type + '|' + message);
}
function webViewClose() {
  // alert("closing");
  var c = document.getElementById('content');
  c.style.display = 'none';
  webViewPostMessage("webview|close");
}
function webViewCancel() {
  var c = document.getElementById('content');
  c.style.display = 'none';
  webViewPostMessage("webview|cancel");
}
function webViewOk() {
  var c = document.getElementById('content');
  c.style.display = 'none';
  webViewPostMessage("webview|ok");
}

function webViewLog(message) {
  webViewPostMessage("log|" + message);
}


function setValue(c, post, prefix, arr, main) {
  for (var i = 0; i < arr.length; i++) {
    var e = document.getElementById(prefix + '_button_' + i);
    if (!e) {
      continue;
    }
    if (i == c) {
      e.classList.add("selected");
      if (e.firstElementChild) {
        e.firstElementChild.classList.add("selected");
      }
    } else {
      e.classList.remove("selected");
      if (e.firstElementChild) {
        e.firstElementChild.classList.remove("selected");
      }
    }
  }
  if (post) {
    webViewPostMessage(main + '_' + prefix + '|' + arr[c]);
  }
  return false;
}


function getButtonHtml(caption, onClick, baseCls, dividerCls, rounded, selectedCls, id, joined) {
  var idStr = id ? ('id="' + id + '"') : '';
  var roundedInner = rounded ? 'rounded-inner' : '';
  var roundedMiddle = rounded ? 'rounded-middle' : '';
  var roundedOuter = rounded ? 'rounded-outer' : '';
  return '<div class="inrow">' +
    (joined ? '' : '<div class="' + baseCls + ' ' + roundedOuter + ' backdrop">') +
      (joined ? '' : '<div class="' + baseCls + ' ' +  roundedOuter + ' border">') +
        '<div class="' + baseCls + ' ' + dividerCls + ' ' + roundedMiddle + ' ' + selectedCls + ' bottomgradient" onclick="' + onClick + '"' + ' ' + idStr + '>' +
          '<div class="' + baseCls + ' ' + roundedInner + ' ' + selectedCls + ' buttonface">' +
            caption +
          '</div>' +
        '</div>' +
      (joined ? '' : '</div>') +
    (joined ? '' : '</div>') +
  '</div>';
}

function getActionButtonsHtml(buttons, joined) {
  var html = (joined ? '' : '<div class="centered island">');
  html += '<div class="buttonrow">';
  for (var i=0; i<buttons.length; i++) {
    var button = buttons[i];
    var baseCls = joined ? 'bottommost ' : '';
    var selected = button.selected ? 'selected' : '';
    if (buttons.length > 1) {
      if (i == 0) {
        baseCls += 'leftmost';
      } else if (i == buttons.length - 1) {
        baseCls += 'rightmost';
      } else {
        baseCls += 'middle';
      }
    }
    html += getButtonHtml(button.caption, button.onClick, baseCls, '', true, selected, button.id, joined);
  }
  html += '</div>';
  html += (joined ? '' : '</div>');
  return html;
}

function getToggleButtonsHtml(options) {
  // Start top div
  var idStr = options.id ? ('id="' + options.id + '"') : '';
  var html =
    '<div class="' + options.topClass + '" ' + idStr + '>';
  {
    // Header
    html +=
      '<div class="topmost backdrop rounded-outer">' +
      '<div class="topmost border black rounded-middle">' +
        '<div class="topmost headerface rounded-inner">' +
          options.header +
        '</div>' +
      '</div>' +
    '</div>';

    // Buttons

    // Start buttonrow
    html += '<div class="buttonrow">';

    for (var i = 0; i < options.buttons.length; i++) {
      var button = options.buttons[i];

      var rounded = true;
      var baseCls = 'bottommost';
      var dividerCls = 'topdivider';
      if (i == 0) {
        // Left
        dividerCls += ' rightdivider';
        baseCls += ' leftmost';
      } else if (i == options.buttons.length - 1) {
        // Right
        dividerCls += ' leftdivider';
        baseCls += ' rightmost';
      } else {
        // Middle
        dividerCls += ' leftdivider rightdivider';
        baseCls += ' middle';
        rounded = false;
      }
      html += getButtonHtml(button.caption, button.onClick, baseCls, dividerCls, rounded, '', button.prefix + '_button_' + i);
    }
    // End buttonrow
    html += '</div>';
  }
  // End top div
  html += '</div>';
  return html;
}

function capitalizeFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

function addElementKeyAction(id, code, action) {
  var element = document.getElementById(id);
  element.addEventListener("keyup", function(event) {
    // Call attemptSignIn() when pressing enter key in password input
    if (event.keyCode === code) { // keyCode is deprecated, but it seems to work
      event.preventDefault();
      action();
    }
  });
}

function addElementEnterKeyAction(id, action) {
  addElementKeyAction(id, 13, action);
}

// hack to make mobile browsers properly set :active on touch
document.addEventListener("touchstart", function() {}, false);