function save(form) {
    var data = {};
    form.querySelectorAll("input, select, textarea").forEach(function (field) {
        data[field.name] = field.value;
    });
    chrome.storage.sync.set(data);
}

window.addEventListener("load", function () {
    chrome.storage.sync.get(null, function (data) {
        document.querySelector("#options").querySelectorAll("input, select, textarea").forEach(function(field) {
            if (typeof data[field.name] != "undefined") {
                field.value = data[field.name];
            }
        });
    });

    document.querySelector("#options").addEventListener("submit", function (event) {
        event.preventDefault();
        save(this);
    });

    document.querySelector("#options").querySelectorAll("input, select, textarea").forEach(function (field) {
        field.addEventListener("change", function () {
            save(this.form);
        });
    });
});