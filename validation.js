if (document.currentScript == null) {
    var script = document.createElement("script");
    script.src = chrome.extension.getURL("validation.js");
    script.onload = function() {
        this.remove();
    };
    document.head.appendChild(script);

    var htmlQueue = [];
    var cssQueue = [];

    window.addEventListener("message", function(event) {
        var request = event.data;
        if (typeof request == "object" && typeof request.action == "string" && typeof request.data == "string") {
            switch (request.action) {
                case "validateHTML":
                    var resolve;
                    htmlQueue.push(new Promise((_resolve) => {
                        resolve = _resolve;
                    }));
                    var f = function () {
                        var headers = new Headers();
                        headers.append("Content-Type", "text/html");
                        headers.append("charset", "utf-8");
                        fetch("https://validator.w3.org/nu/?out=json", {method: "POST", body: request.data, headers: headers})
                            .then((res) => res.json())
                            .then((data) => {
                                window.postMessage({action: "callback", success: true, id: request.id, data: data}, window.location.origin);
                                resolve();
                                htmlQueue.splice(0, 1);
                            })
                            .catch((error) => {
                                window.postMessage({action: "callback", success: false, error: error.message, id: request.id}, window.location.origin);
                                resolve();
                                htmlQueue.splice(0, 1);  
                            });
                    };
                    if (htmlQueue.length == 1) {
                        f();   
                    } else {
                        htmlQueue[htmlQueue.length - 2].then(() => {
                            setTimeout(f, 1000);
                        });
                    }
                    return true;
                case "validateCSS":
                    var resolve;
                    var promise = new Promise((_resolve) => {
                        resolve = _resolve;
                    });
                    cssQueue.push(promise);
                    var f = function () {
                        var boundary = "BOUNDARY";
                        var headers = new Headers();
                        headers.append("Content-Type", "multipart/form-data; boundary="+boundary);
                        var body = 
`--${boundary}
Content-Disposition: form-data; name="text"

${request.data}
--${boundary}
Content-Disposition: form-data; name="profile"

css3
--${boundary}
Content-Disposition: form-data; name="usermedium"

all
--${boundary}
Content-Disposition: form-data; name="type"

css
--${boundary}
Content-Disposition: form-data; name="warning"

1
--${boundary}
Content-Disposition: form-data; name="vextwarning"


--${boundary}
Content-Disposition: form-data; name="lang"

en
--${boundary}
Content-Disposition: form-data; name="output"

json
--${boundary}`;
                        fetch("https://jigsaw.w3.org/css-validator/validator", {method: "POST", body, headers})
                            .then((res) => res.json())
                            .then((data) => {
                                window.postMessage({action: "callback", success: true, id: request.id, data: data}, window.location.origin);
                                resolve();
                                cssQueue.splice(0, 1);
                            })
                            .catch((error) => {
                                window.postMessage({action: "callback", success: false, error: error.message, id: request.id}, window.location.origin);
                                resolve();
                                cssQueue.splice(0, 1);
                            });
                    };
                    if (cssQueue.length == 1) {
                        f();
                    } else {
                        cssQueue[cssQueue.length - 2].then(() => {
                            setTimeout(f, 1000);
                        });
                    }
                    return true;
            }
        }
    });
} else {
    var validate = (function () {

        var id = 0;
        function api(action, data) {
            return new Promise(function (resolve, reject) {
                window.postMessage({action, data, id}, window.location.origin);
                window.addEventListener("message", (function (id) {
                    var cbID = id;
                    return function (event) {
                        var data = event.data;
                        if (data.action == "callback" && data.id == cbID) {
                            if (data.success) {
                                resolve(data.data);
                            } else {
                                reject(data.error);
                            }
                        }
                    }
                })(id));
                id++;
            });
        }

        function validateHTML(file, line, data) {
            return new Promise(function (resolve, reject) {
                new Promise(function (resolve, reject) {
                    if (typeof line != "number") line = 1;
                    if (typeof data != "string") fetch(file).then((res) => res.text()).then((data) => resolve(data)).catch((error) => reject(error));
                    else resolve(data);
                })
                    .then((data) => api("validateHTML", data))
                    .then((result) => {
                        var messages = [];
                        result.messages.forEach(function (i) {
                            messages.push({
                                line: line + (i.lastLine | 0) - 1,
                                message: i.message,
                                type: i.type
                            });
                        });
                        resolve({messages, file, type: "HTML", start: line});
                    })
                    .catch((error) => reject({file, error, type: "HTML", start: line}));
            });
        }

        function validateCSS(file, line, data) {
            return new Promise(function (resolve, reject) {
                new Promise(function (resolve, reject) {
                    if (typeof line != "number") line = 1;
                    if (typeof data != "string") fetch(file).then((res) => res.text()).then((data) => resolve(data)).catch((error) => reject(error));
                    else resolve(data);
                }).then((data) => api("validateCSS", data))
                    .then((result) => {
                        var result = result.cssvalidation;
                        var messages = [];
                        if (typeof result.errors != "undefined") {
                            result.errors.forEach(function(msg) {
                                messages.push({
                                    type: "error",
                                    line: line + msg.line - 1,
                                    message: msg.message
                                });
                            });
                        }
                        if (typeof result.warnings != "undefined") {
                            result.warnings.forEach(function(msg) {
                                messages.push({
                                    type: "warning",
                                    line: line + msg.line - 1,
                                    message: msg.message
                                });
                            });
                        }
                        resolve({file, messages, type: "CSS", start: line});
                    })
                    .catch((error) => reject({file, error, type: "CSS", start: line}));
            });
        }

        function getStyleElementLineNumber(element) {
            return new Promise(function (resolve, reject) {
                var file = element.ownerDocument.location.href;
                fetch(file)
                    .then((res) => res.text())
                    .then((source) => resolve((source.split(element.innerHTML)[0].match(/\n/g) || []).length + 1))
                    .catch((error) => reject({file, error, type: "CSS", start: 0}));
            });
        }

        function _validate(target) {
            return new Promise(function (resolve, reject) {
                if (target instanceof Document) validateHTML(target.location.href).then(resolve).catch((message) => reject(message));
                if (target instanceof StyleSheet) {
                    if (target.ownerNode instanceof HTMLLinkElement) validateCSS(target.ownerNode.href).then(resolve).catch((message) => reject(message));
                    else if (target.ownerNode instanceof HTMLStyleElement) 
                        getStyleElementLineNumber(target.ownerNode).catch((message) => reject(message)).then((ln) => validateCSS(
                            target.ownerNode.ownerDocument.location.href,
                            ln, 
                            target.ownerNode.innerHTML
                        )).then(resolve).catch((message) => reject(message));
                    else reject();
                }
            });
        }

        function wait(promises, cb) {
            var resolved = [];
            var rejected = [];
            var check = function () {
                if (resolved.length + rejected.length == promises.length) {
                    cb(resolved, rejected);
                }
            };
            promises.forEach((promise) => {
                promise.then((value) => {
                    resolved.push(value);
                    check();
                }).catch((value) => {
                    rejected.push(value);
                    check();
                });
            });
        }

        var styles = {
            error: {
                icon:
                `
                    background-image: url(Images/smallIcons_2x.png);
                    background-size: 225px;
                    background-position: -24px 0px;
                    padding-left: 10px;
                `,
                text: ''
            },
            hasError: {
                icon:
                `
                    background-image: url(Images/smallIcons_2x.png);
                    background-size: 225px;
                    background-position: 83px 0px;
                    padding-left: 10px;
                `
            },
            warning: {
                icon:
                ` 
                    background-image: url(Images/smallIcons_2x.png);
                    background-size: 225px;
                    background-position: -71px 0px;
                    padding-left: 10px;
                `,
                text: ''
            },
            hasWarning: {
                icon:
                `
                    background-image: url(Images/smallIcons_2x.png);
                    background-size: 225px;
                    background-position: 35px 0px;
                    padding-left: 10px;
                `
            },
            pass: {
                icon: 
                `
                    background-image: url(Images/smallIcons_2x.png);
                    background-size: 225px;
                    background-position: 59px 0px;
                    padding-left: 10px;
                `,
                text: ''
            },
            default: {
                icon:
                `
                    padding-left: 10px;
                `,
                text: ''
            }

        };

        return function (target) {
            var validations = [];
            console.group("%cW3C validation\n%cExtension by Jesse Sivonen", "font-size: 50px; font-family: serif;", "font-size: 14px;");
            console.groupCollapsed("Network log");
            if (typeof target != "undefined") validations.push(_validate(target));
            else {
                validations.push(_validate(document));
                for (var i = 0; i < document.styleSheets.length; i++) {
                    validations.push(_validate(document.styleSheets.item(i)));
                }
            }
            wait(validations, (reports, errors) => {
                console.groupEnd(); // Network log

                if (reports.length > 0) {
                    console.group("Reports");
                    reports.forEach((report) => {
                        var origin = window.location.origin;
                        var relativeUrl = report.file.replace(origin, "");
                        if (report.messages.length == 0) {
                            console.log(`%c %c${report.type}: ${report.file}${report.start > 0 ? ':'+report.start : ''}`, styles.pass.icon, styles.pass.text);
                        } else {
                            var type = "";
                            report.messages.forEach((message) => {
                                if (message.type == "error") {
                                    type = "error";
                                } else if (message.type == "warning" && type != "error") {
                                    type = "warning";
                                }
                            });
                            var style = styles.default;
                            if (type == "error") style = styles.hasError;
                            if (type == "warning") style = styles.hasWarning;
                            console.groupCollapsed(`%c %c${report.type}: ${report.file}${report.start > 0 ? ':'+report.start : ''}`, style.icon, style.text);
                            report.messages.forEach((message) => {
                                style = styles.default;
                                if (message.type == "error") style = styles.error;
                                if (message.type == "warning") style = styles.warning;
                                console.groupCollapsed(`%c %c${message.message}`, style.icon, style.text);
                                console.log(`at ${report.file}:${message.line}`);
                                console.groupEnd();
                            });
                            console.groupEnd();
                        }
                    });
                    console.groupEnd();
                }

                if (errors.length > 0) {
                    console.group("Errors");
                    errors.forEach((error) => {
                        if (typeof error.error != "undefined") {
                            console.error("Could not validate " + error.file + ":", error.error);
                        } else {
                            console.error("Could not validate " + error.file + ":", "Unknown error!");
                        }
                    });
                    console.groupEnd();
                }

                console.groupEnd(); // W3C validation
            });
        };
    })();
}