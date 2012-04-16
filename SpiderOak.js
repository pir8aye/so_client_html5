/* SpiderOak html5 client Main app.

 * Uses:
 * - jquery.mobile-1.0.1.min.css
 * - jquery-1.6.4.min.js
 * - jquery.mobile-1.0.1.min.js
 */


$(document).ready(function() {
    spideroak.init();
    $('.nav_login_storage form').submit(function () {
        var username = $('input[name=username]', this).val();
        var password = $('input[name=password]', this).val();
        spideroak.remote_login({username: username, password: password});
        return false;
    });
});

/* Modular singleton pattern: */
var spideroak = function() {
    /* private: */
    /* "?callback=" is automatically included if $.ajax(dataType: 'jsonp') */
    var storage_root = "https://spideroak.com/storage/%s/login";

    /* public: */
    return {
        init: function () {
            /* Nothing, yet. */
            },
        remote_login: function (login_info, url) {
            var url = url || storage_root
            var login_url = url.replace(/%s/,
                                        b32encode_trim(login_info['username']));
            $.ajax({
                url: login_url,
                type: 'POST',
                dataType: 'text',
                data: login_info,
                crossDomain: true,
                success: function (data) {
                    var match = data.match(/^(login|location):(.+)$/m);
                    if (!match) {
                        alert(translate('Temporary server failure. Please'
                                        + ' try again in a few minutes.'));
                    } else if (match[1] == 'login') {
                        remote_login(login_info, match[2]);
                    } else {
                        window.location.href = match[2];
                    }
                },
                error: function (xhr) {
                    if (xhr.status == 403) {
                        alert(translate('Incorrect username or password.'));
                    } else if (xhr.status == 404) {
                        alert(translate('Incorrect ShareID or RoomKey.'));
                    } else {
                        alert(translate('Temporary server failure. Please'
                                        + ' try again in a few minutes.'));
                    }
                }
            });
        }
    }
}();
