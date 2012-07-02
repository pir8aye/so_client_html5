/* SpiderOak html5 client Main app.

 * Works with:
 * - jquery.mobile-1.0.1.css
 * - jquery-1.6.4.js
 * - jquery.mobile-1.0.1.js
 * - js_aux/misc.js - blather(), fragment_quote(), error_alert(), ...
 * - Nibbler 2010-04-07 - base32 encode, decode, and enhance with encode_trim.
 * - custom-scripting.js - jqm settings and contextual configuration
 */

/*
  NOTES

  - Content visits:
    We intercept navigation to content (eg, $.mobile.changePage) repository
    URLs and intervene via binding of handle_content_visit to jQuery mobile
    "pagebeforechange" event. URLs included as href links must start with
    '#' to trigger jQuery Mobile's navigation detection, which by default
    tracks changes to location.hash.  handle_content_visit() dispatches those
    URLs it receives that reside within the ones satisfy .is_content_root_url(),
    to which the root URLs are registered by the root visiting routines.

  - My routines which return jQuery objects end in '$', and - following common
    practice - my variables intended to contain jQuery objects start with '$'.
*/

// For misc.js:blather() and allowing dangerous stuff only during debugging.
SO_DEBUGGING = true;

var spideroak = function () {
    /* SpiderOak application object, as a modular singleton. */
    "use strict";               // ECMAScript 5


    /* == Private elements == */

    /* ==== Object-wide settings ==== */

    var generic = {
        /* Settings not specific to a particular login session: */
        // API v1.
        // XXX base_host_url may vary according to brand package.
        base_host_url: "https://spideroak.com",
        combo_root_url: "https://home",
        combo_root_page_id: "home",
        storage_root_page_id: "storage-home",
        original_shares_root_page_id: "original-home",
        public_shares_root_page_id: "share-home",
        content_page_template_id: "content-page-template",
        storage_login_path: "/browse/login",
        storage_logout_suffix: "logout",
        storage_path_prefix: "/storage/",
        original_shares_path_suffix: "shares",
        shares_path_suffix: "/share/",
        devices_query_expression: 'device_info=yes',
        versions_query_expression: 'format=version_info',
        home_page_id: 'home',
        root_storage_node_label: "Devices",
        preview_sizes: [25, 48, 228, 800],
        dividers_threshold: 10,
        filter_threshold: 20,
        public_share_room_urls: {},
        simple_popup_id: 'simple-popup',
    };
    var my = {
        /* Login session settings: */
        username: "",
        storage_host: null,
        storage_web_url: null,  // Location of storage web UI for user.
        storage_root_url: null,
        original_shares_root_url: null,
        // All the service's actual shares reside within:
        public_shares_root_url: generic.base_host_url + "/share/",
        original_share_room_urls: {},
    };

    var base32 = new Nibbler({dataBits: 8,
                              codeBits: 5,
                              keyString: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
                              pad: '='});
    Nibbler.prototype.encode_trim = function (str) {
        /* Base32 encoding with trailing "=" removed. */
        return this.encode(str).replace(/=+$/, ''); }


    /* ==== Navigation handlers ==== */

    function handle_content_visit(e, data) {
        /* Intercept URL visits and intervene for repository content. */
        var page = internalize_url(data.toPage);

        if ((typeof page === "string")
            && (is_content_url(page)
                || document_addrs.hasOwnProperty(page))) {
            e.preventDefault();
            if (transit_manager.is_repeat_url(page)) {
                // Popup dismissal sends the URL back through, and the
                // default machinery needs to see it.
                return true; }
            var mode_opts = query_params(page);
            if (document_addrs.hasOwnProperty(page)) {
                var internal = internalize_url(document.location.href);
                return document_addrs[page].call(this, internal); }
            else {
                var node = content_node_manager.get(page);
                return node.visit(data.options, mode_opts); }}}

    function establish_traversal_handler() {
        /* Establish page change event handler. */
        $(document).bind("pagebeforechange.SpiderOak", handle_content_visit); }


    /* ==== Content Root Registration ====  */

    function set_storage_account(username, storage_host, storage_web_url) {
        /* Register confirmed user-specific storage details.  Return the
           storage root URL.
           'username' - the account name
           'storage_host' - the server for the account
           'storage_web_url' - the account's web UI entry address
        */

        var storage_url = register_storage_root(storage_host, username,
                                                storage_web_url);
        if (! is_content_root_url(storage_url)) {
            register_content_root_url(storage_url); }

        if (remember_manager.active()) {
            remember_manager.store({username: username,
                                    storage_host: storage_host,
                                    storage_web_url: storage_web_url}); }

        // Now let's direct the caller to the combo root:
        return my.combo_root_url; }
    function clear_storage_account() {
        /* Obliterate internal settings and all content nodes for a clean slate.
           All share artifacts, original and other, are removed, as well
           as registered storage.  We do not remove persistent settings. */

        if (my.original_shares_root_url) {
            var original_shares_root = cnmgr.get(my.original_shares_root_url);
            original_share_room_urls_list().map(
                original_shares_root.clear_item)
            // remove_item, above, frees the rooms and contents.
            cnmgr.free(original_shares_root); }
        my.original_shares_root_url = "";

        if (my.storage_root_url) {
            content_node_manager.clear_hierarchy(my.storage_root_url); }
        my.storage_root_url = "";

        content_node_manager.free(content_node_manager.get_combo_root());

        my.username = "";
        my.storage_host = "";
        my.storage_web_url = ""; }


    /* ===== Node-independent content URL categorization ==== */

    // Managed content is organized within two content roots:
    //
    // - the storage root, my.storage_root_url, determined by the user's account
    // - the public share root, which is the same across all accounts
    //
    // There is also a collection of the shares originated by the account,
    // in the OriginalRootShareNode.  Like all SpiderOak share rooms, the
    // items are actually public shares, but the collection listing is only
    // visible from within the account.
    //
    // Content urls are recognized by virtue of beginning with one of the
    // registered content roots. The storage root is registered when the user
    // logs in. The share rooms root is registered upon the registration of
    // any share room.

    function register_storage_root(host, username, storage_web_url) {
        /* Identify user's storage root according to 'host' and 'username'.
           The account's 'storage_web_url' is also conveyed.
           Return the url. */
        my.username = username;
        my.storage_host = host;
        my.storage_web_url = storage_web_url;

        my.storage_root_url = (host
                               + generic.storage_path_prefix
                               + base32.encode_trim(username)
                               + "/");
        // Original root is determined by storage root:
        register_original_shares_root();

        return my.storage_root_url; }

    function register_original_shares_root() {
        /* Identify original share rooms root url. Depends on established
           storage root.  Return the url. */
        my.original_shares_root_url =
            (my.storage_root_url + generic.original_shares_path_suffix); }
    function register_public_share_room_url(url) {
        /* Include url among the registered share rooms.  Returns the url. */
        generic.public_share_room_urls[url] = true;
        return url; }
    function unregister_public_share_room_url(url) {
        /* Remove 'url' from the registered public share rooms.
           Returns the url, or none if nothing to unregister. */
        if (generic.public_share_room_urls.hasOwnProperty(url)) {
            delete generic.public_share_room_urls[url];
            return url; }}
    function register_original_share_room_url(url) {
        /* Include url among the registered original rooms.
           Also registers among the set of all familiar share room urls.
           Returns the url. */
        my.original_share_room_urls[url] = true;
        return url; }
    function unregister_original_share_room_url(url) {
        /* Remove 'url' from the registered original share rooms.
           Returns the url, or none if nothing to unregister. */
        if (my.original_share_room_urls.hasOwnProperty(url)) {
            delete my.original_share_room_urls[url];
            return url; }}
    function is_combo_root_url(url) {
        return (url === my.combo_root_url); }
    function is_content_root_url(url) {
        /* True if the 'url' is for one of the root content items.
           Doesn't depend on the url having an established node. */
        return ((url === my.combo_root_url)
                || (url === my.storage_root_url)
                || (url === my.original_shares_root_url)
                || (url === my.public_shares_root_url)); }
    function is_content_root_page_id(url) {
        return ((url === generic.combo_root_page_id)
                || (url === generic.storage_root_page_id)
                || (url === generic.public_shares_root_page_id)
                || (url === generic.original_shares_root_page_id)); }
    function is_share_room_url(url) {
        /* True if the 'url' is for one of the familiar share rooms.
           Doesn't depend on the url having an established node. */
        return (is_original_share_room_url(url)
                || is_public_share_room_url(url)); }
    function is_original_share_room_url(url) {
        /* True if the 'url' is for one of the original share rooms.
           Doesn't depend on the url having an established node. */
        return my.original_share_room_urls.hasOwnProperty(url); }
    function is_public_share_room_url(url) {
        /* True if the 'url' is for one of the original share rooms.
           Doesn't depend on the url having an established node. */
        return generic.public_share_room_urls.hasOwnProperty(url); }
    function is_storage_url(url) {
        /* True if the URL is for a content item in the user's storage area.
           Doesn't depend on the url having an established node. */
        return (my.storage_root_url
                && (url.slice(0, my.storage_root_url.length)
                    === my.storage_root_url)); }
    function is_share_url(url) {
        /* True if the URL is for a content item in the user's storage area.
           Does not include the original shares root.
           Doesn't depend on the url having an established node. */
        return (my.public_shares_root_url
                && (url.slice(0, my.public_shares_root_url.length)
                    === my.public_shares_root_url)); }
    function is_content_url(url) {
        /* True if url within registered content roots. */
        url = internalize_url(url); // ... for content root page ids.
        return (is_storage_url(url)
                || is_share_url(url)
                || is_combo_root_url(url)
                || is_content_root_url(url)); }

    function public_share_room_urls_list() {
        /* Return an array of public share room urls being visited. */
        return Object.keys(generic.public_share_room_urls); }
    function original_share_room_urls_list() {
        /* Return an array of original share room urls being visited. */
        return Object.keys(my.original_share_room_urls); }

    /* ===== Data model ==== */

    /* SpiderOak content includes storage (backups) and share rooms. The
       data model distinguishes different kinds of those things - the
       roots, devices, folders, and files - and wraps them in abstract
       general types - the ContentNode and variants of it, where useful. */

    function ContentNode(url, parent) {
        /* Constructor for items representing stored content.
           - 'url' is absolute URL for the collection's root (top) node.
           - 'parent' is containing node. The root's parent is null.
           See JSON data examples towards the bottom of this script.
        */
        if ( !(this instanceof ContentNode) ) {      // Coding failsafe.
            throw new Error("Constructor called as a function");
        }
        if (url) {             // Skip if we're in prototype assignment.
            this.url = url;
            this.name = "";
            this.root_url = parent ? parent.root_url : url;
            this.query_qualifier = "";
            this.parent_url = parent ? parent.url : null;
            this.is_container = true; // Typically.
            this.subdirs = [];  // Urls of contained devices, folders.
            this.files = [];    // Urls of contained files.
            this.$page = null;  // This node's jQuery-ified DOM data-role="page"
            this.lastfetched = false;
            this.emblem = "";   // At least for debugging/.toString()
            this.icon_path = ""; }}
    ContentNode.prototype.free = function () {
        /* Free composite content to make available for garbage collection. */
        if (this.$page) {
            this.$page.remove();
            this.$page = null; }}

    function StorageNode(url, parent) {
        ContentNode.call(this, url, parent);
        // All but the root storage nodes are contained within a device.
        // The DeviceStorageNode sets the device url, which will trickle
        // down to all its contents.
        this.device_url = parent ? parent.device_url : null; }
    StorageNode.prototype = new ContentNode();
    function ShareNode(url, parent) {
        /* Share room abstract prototype for collections, rooms, and contents */
        ContentNode.call(this, url, parent);
        this.root_url = parent ? parent.root_url : null;
        this.room_url = parent ? parent.room_url : null; }
    ShareNode.prototype = new ContentNode();

    function RootContentNode(url, parent) {
        /* Consolidated root of the storage and share content hierarchies. */
        ContentNode.call(this, url, parent);
        this.root_url = url;
        this.emblem = "SpiderOak";
        this.name = "Dashboard";
        delete this.subdirs;
        delete this.files; }
    RootContentNode.prototype = new ContentNode();
    RootContentNode.prototype.free = function () {
        /* Free composite content to make available for garbage collection. */
        if (this.$page) {
            // Do not .remove() the page - it's the original, not a clone.
            this.$page = null; }}
    RootContentNode.prototype.loggedin_ish = function () {
        /* True if we have enough info to be able to use session credentials. */
        return (my.username && true); }

    function RootStorageNode(url, parent) {
        StorageNode.call(this, url, parent);
        this.query_qualifier = "?" + generic.devices_query_expression;
        this.emblem = "Root Storage";
        this.stats = null;
        delete this.files; }
    RootStorageNode.prototype = new StorageNode();
    function RootShareNode(url, parent) {
        ShareNode.call(this, url, parent);
        this.emblem = "Root Share";
        this.root_url = url; }
    RootShareNode.prototype = new ShareNode();
    function PublicRootShareNode(url, parent) {
        RootShareNode.call(this, url, parent);
        this.name = "Public Share Rooms";
        this.emblem = "Public Share Rooms";
        this.job_id = 0; }
    OriginalRootShareNode.prototype = new RootShareNode();
    function OriginalRootShareNode(url, parent) {
        RootShareNode.call(this, url, parent);
        this.name = "My Share Rooms";
        this.emblem = "Originally Published Share Rooms"; }
    PublicRootShareNode.prototype = new RootShareNode();

    function DeviceStorageNode(url, parent) {
        StorageNode.call(this, url, parent);
        this.emblem = "Storage Device";
        this.device_url = url; }
    DeviceStorageNode.prototype = new StorageNode();
    function RoomShareNode(url, parent) {
        ShareNode.call(this, url, parent);
        this.emblem = "Share Room";
        this.room_url = url;
        var splat = url.split('/');
        this.share_id = base32.decode(splat[splat.length-3]);
        this.room_key = splat[splat.length-2]; }
    RoomShareNode.prototype = new ShareNode();

    function FolderContentNode(url, parent) {
        /* Stub, for situating intermediary methods. */ }
    function FileContentNode(url, parent) {
        /* Stub, for situating intermediary methods. */ }

    function FolderStorageNode(url, parent) {
        this.emblem = "Storage Folder";
        StorageNode.call(this, url, parent); }
    FolderStorageNode.prototype = new StorageNode();
    function FolderShareNode(url, parent) {
        this.emblem = "Share Room Folder";
        ShareNode.call(this, url, parent); }
    FolderShareNode.prototype = new ShareNode();

    function FileStorageNode(url, parent) {
        this.emblem = "Storage File";
        StorageNode.call(this, url, parent);
        this.is_container = false;
        delete this.subdirs;
        delete this.files; }
    FileStorageNode.prototype = new StorageNode();
    function FileShareNode(url, parent) {
        this.emblem = "Share Room File";
        ShareNode.call(this, url, parent);
        this.is_container = false;
        delete this.subdirs;
        delete this.files; }
    FileShareNode.prototype = new ShareNode();

    /* ===== Content type and role predicates ==== */

    ContentNode.prototype.is_root = function () {
        /* True if the node is a collections top-level item. */
        return (this.url === this.root_url); }

    ContentNode.prototype.is_device = function() {
        return false; }
    DeviceStorageNode.prototype.is_device = function() {
        return true; }

    /* ===== Remote data access ==== */

    ContentNode.prototype.visit = function (chngpg_opts, mode_opts) {
        /* Fetch current data from server, provision, layout, and present.
           'chngpg_opts': framework changePage() options,
           'mode_opts': node provisioning and layout modal settings. */

        if (! this.up_to_date()) {
            this.fetch_and_dispatch(chngpg_opts, mode_opts); }
        else {
            this.show(chngpg_opts, mode_opts); }}

    RootContentNode.prototype.visit = function (chngpg_opts, mode_opts) {
        /* Do the special visit of the consolidated storage/share root. */

        // Trigger visits to the respective root content nodes in 'passive'
        // mode so they do not focus the browser on themselves. 'notify' mode
        // is also provoked, so they report their success or failure to our
        // notify_subvisit_status() method.
        //
        // See docs/AppOverview.txt "Content Node navigation modes" for
        // details about mode controls.

        this.veil(true);
        this.veil(false);

        this.remove_status_message();

        this.show(chngpg_opts, {});

        // We always dispatch the public shares visit:
        var public_mode_opts = {passive: true,
                                notify_callback:
                                    this.notify_subvisit_status.bind(this),
                                notify_token: 'public-shares'};
        $.extend(public_mode_opts, mode_opts);
        var public_root = cnmgr.get(my.public_shares_root_url);
        public_root.visit(chngpg_opts, public_mode_opts);

        if (! this.loggedin_ish()) {
            // Not enough registered info to try authenticating:
            this.authenticated(false);
            this.layout(mode_opts);
            this.show(chngpg_opts, {}); }

        else {
            var storage_root = content_node_manager.get(my.storage_root_url);
            // Use a distinct copy of mode_opts:
            var storage_mode_opts = $.extend({}, public_mode_opts);
            storage_mode_opts.notify_token = 'storage';
            // Will chain to original shares via notify_callback.
            storage_root.visit(chngpg_opts, storage_mode_opts); }}

    PublicRootShareNode.prototype.visit = function (chngpg_opts, mode_opts) {
        /* Obtain the known, non-original share rooms and present them. */
        // Our content is the set of remembered urls, from:
        // - those visited in this session
        // - those remembered across sessions

        this.remove_status_message();

        if (mode_opts.hasOwnProperty('action')) {
            var action = mode_opts.action;
            if (this[action] && this[action].is_action) {
                var got = this[action](mode_opts.subject);
                this.do_presentation(chngpg_opts, {});
                return got; }}

        // this.add_item() only adds what's missing, and sets this.subdirs.
        this.get_subdir_prospects().map(this.add_item.bind(this));
        this.do_presentation(chngpg_opts, mode_opts); }

    PublicRootShareNode.prototype.get_subdir_prospects = function () {
        /* Load the subdirs list from active list and persistence. */
        var subdirs = public_share_room_urls_list();
        var persisted = persistence_manager.get('public_share_urls') || {};
        var additions = [];
        Object.keys(persisted).map(function (item) {
            if (subdirs.indexOf(item) === -1) {
                additions.push(item); }});
        return subdirs.concat(additions); }

    ContentNode.prototype.fetch_and_dispatch = function (chngpg_opts,
                                                         mode_opts) {
        /* Retrieve this node's data and deploy it.
           'chngpg_opts' - Options for the framework's changePage function
           'mode_opts': node provisioning and layout modal settings.

           - On success, call this.handle_visit_success() with the retrieved
             JSON data, new Date() just prior to the retrieval, chngpg_opts,
             mode_opts, a text status categorization, and the XMLHttpRequest
             object.
           - Otherwise, this.handle_visit_failure() is called with the
             XMLHttpResponse object, chngpg_opts, mode_opts, the text status
             categorization, and an exception object, present if an exception
             was caught.

           See the jQuery.ajax() documentation for XMLHttpResponse details.
        */

        var when = new Date();
        var url = this.url + this.query_qualifier;
        $.ajax({url: url,
                type: 'GET',
                dataType: 'json',
                cache: false,
                success: function (data, status, xhr) {
                    this.handle_visit_success(data, when,
                                              chngpg_opts, mode_opts,
                                              status, xhr); }.bind(this),
                error: function (xhr, statusText, thrown) {
                    this.handle_visit_failure(xhr, chngpg_opts, mode_opts,
                                              statusText,
                                              thrown)}.bind(this), })}

    RootContentNode.prototype.notify_subvisit_status = function(succeeded,
                                                                token,
                                                                response) {
        /* Callback passed to subordinate root content nodes to signal their
           update disposition:
           'succeeded': true for success, false for failure.
           'token': token they were passed to identify the transaction,
           'response': on failure: the resulting XHR object. */

        if (token !== 'public-shares') {
            this.authenticated(true); }

        var $page = this.my_page$();
        var selector = ((token === 'storage')
                        ? "#my-storage-leader"
                        : "#my-rooms-leader")
        var $leader = $(selector);

        if (! succeeded) {
            $.mobile.loading('hide');
            if (token === "storage") {
                this.authenticated(false, response);
                this.layout(); }}
        else {
            this.layout();

            if (token === 'storage') {
                // Ensure we're current page and chain to original shares root.

                this.layout({}, {});
                this.show({}, {});

                var our_mode_opts = {passive: true,
                                     notify_callback:
                                       this.notify_subvisit_status.bind(this),
                                     notify_token: 'original-share'};
                if (this.veiled) {
                    this.veil(false, function() { $.mobile.loading('hide'); });}
                this.authenticated(true, response);
                var ps_root = cnmgr.get(my.original_shares_root_url, this);
                ps_root.visit({}, our_mode_opts); }}}

    PublicRootShareNode.prototype.notify_subvisit_status = function(succeeded,
                                                                   token,
                                                                   content) {
        /* Callback for subordinate share nodes to signal their visit result:
           'succeeded': true for success, false for failure.
           'token': token we passed in to identify transaction and convey info:
                    [job_id, subnode_URL],
           'content': on success: the jquery $(dom) for the populated content,
                      for failure: the resulting XHR object. */
        // We ignore the content.

        var $page = this.my_page$();
        var sub_job_id = token[0];
        var url = token[1];
        var splat = url.split('/');
        var share_id = base32.decode(splat[splat.length-3]);
        var room_key = splat[splat.length-2];

        var which_msg = share_id + " / " + room_key;

        if (succeeded !== true) {
            this.remove_status_message('result');
            var message = (_t("Sorry") + " - " + which_msg + " "
                           + content.statusText + " (" + content.status + ")");
            var remove = true;
            if (content.status === 404) {
                this.show_status_message(message); }
            else {
                message = [].concat(message, " - omit it?");
                remove = confirm(message); }
            if (remove) {
                this.remove_item(url);
                this.unpersist_item(url); }}
        else {
            this.remove_status_message('error');
            var $sm = this.show_status_message(_t("Added")
                                               + ": " + which_msg, 'result');
            if (persistence_manager.get('retaining_visits')) {
                this.persist_item(url); }}

        // Do update, whether or not it was successful:
        this.subdirs = public_share_room_urls_list()
        this.subdirs.sort(content_nodes_by_url_sorter)
        this.do_presentation({}, {passive: true});
        // XXX Feeble: always updating the combo root is too intertwined.
        cnmgr.get_combo_root().layout(); }

    ContentNode.prototype.handle_visit_success = function (data, when,
                                                           chngpg_opts,
                                                           mode_opts,
                                                           status, xhr) {
        /* Deploy successfully obtained node data.
           See ContentNode.fetch_and_dispatch() for parameter details. */
        this.provision(data, when, mode_opts);
        this.layout(mode_opts);
        this.show(chngpg_opts, mode_opts);
        if (mode_opts.notify_callback) {
            mode_opts.notify_callback(true,
                                      mode_opts.notify_token); }}

    ContentNode.prototype.handle_visit_failure = function (xhr,
                                                           chngpg_opts,
                                                           mode_opts,
                                                           exception) {
        /* Do failed visit error handling with 'xhr' XMLHttpResponse report. */
        if (mode_opts.notify_callback) {
            mode_opts.notify_callback(false, mode_opts.notify_token, xhr); }
        else {
            $.mobile.loading('hide');
            alert("Visit '" + this.name + "' failed: "
                  + xhr.statusText + " (" + xhr.status + ")");
            var combo_root = content_node_manager.get_combo_root();
            if (! is_combo_root_url(this.url)) {
                // Recover upwards, eventually to the top:
                $.mobile.changePage(this.parent_url
                                    ? this.parent_url
                                    : combo_root.url); }}}

    RootContentNode.prototype.handle_visit_failure = function (xhr,
                                                               chngpg_opts,
                                                               mode_opts,
                                                               exception) {
        /* Do failed visit error handling with 'xhr' XMLHttpResponse report. */
        this.layout();
        this.authenticated(false, xhr, exception); }

    RootContentNode.prototype.authenticated = function (succeeded, response,
                                                        exception) {
        /* Present login challenge versus content, depending on access success.
           'succeeded': true for success, false for failure.
           'response': on failure: the resulting XHR object, if any.
           'exception': on failure, exception caught by ajax machinery, if any.
         */
        var $page = this.my_page$();
        var $content_section = $page.find('.my-content');
        var $login_section = $page.find('.login-section');

        if (succeeded) {
            // Show the content instead of the form
            $login_section.hide();
            this.remove_status_message();
            $content_section.show();
            if (remember_manager.active()) {
                // remember_manager will store just the relevant fields.
                remember_manager.store(my);
                this.layout_header(); }}
        else {
            // Include the xhr.statusText in the form.
            this.veil(false);
            $content_section.hide();
            $login_section.show();
            var username;
            if (remember_manager.active()
                && (username = persistence_manager.get('username'))) {
                $('#my_login_username').val(username); }
            if (response) {
                var error_message = response.statusText;
                if (exception) {
                    error_message += " - " + exception.message; }
                this.show_status_message(error_message);
                if (response.status === 401) {
                    // Unauthorized - expunge all privileged info:
                    clear_storage_account(); }}
            // Hide the storage and original shares sections
            $content_section.hide();
            if (this.veiled) { this.veil(false); }}}

    PublicRootShareNode.prototype.actions_menu_link = function (subject_url) {
        /* Create a menu for 'subject_url' using 'template_id'.  Return an
           anchor object that will popup the menu when clicked. */

        var href = ('#' + this.url
                    + '?action=enlisted_room_menu&subject='
                    + subject_url)
        href = transit_manager.distinguish_url(href);

        var $anchor = $('<a/>');
        $anchor.attr('href', href);
        $anchor.attr('data-icon', 'gear');
        $anchor.attr('title', "Actions menu");
        // Return it for deployment:
        return $anchor; }

    PublicRootShareNode.prototype.enlisted_room_menu = function (subject_url) {
        /* For an enlisted RoomShareNode 'subject_url', furnish the simple
         * popup menu with context-specific actions. */

        var fab_anchor = function (action, subject_url, icon_name, item_text) {
            var href = (this.here() + '?action=' + action
                        + '&subject=' + subject_url);
            return ('<a href="' + href + '" data-icon="' + icon_name + '"'
                    + 'data-mini="true" data-iconpos="right">'
                    + item_text + '</a>')}.bind(this);

        var $popup = $('#' + generic.simple_popup_id);
        var subject_room = content_node_manager.get(subject_url);

        var $listview = $popup.find('[data-role="listview"]');
        // Ditch prior contents:
        $listview.empty()

        var popup_id = '#' + generic.simple_popup_id;
        var $popup = $(popup_id);
        $popup.find('.title').html('<span class="subdued">Room: </span>'
                                   + elide(subject_room.title(), 50));
        $popup.find('.close-button').attr('href',
                                          this.here() + '?refresh=true');

        var $remove_li = $('<li/>');
        $remove_li.append(fab_anchor('remove_item',
                                     subject_url,
                                     'delete',
                                     _t("Drop this room from the list")));

        var $persistence_li = $('<li/>');
        if (this.is_persisted(subject_url)) {
            $persistence_li.append(fab_anchor('unpersist_item',
                                              subject_url,
                                              'minus',
                                              _t("Stop retaining across"
                                                 + " sessions"))); }
        else {
            $persistence_li.append(fab_anchor('persist_item',
                                              subject_url,
                                              'plus',
                                              "Retain across sessions")); }
        $listview.append($remove_li, $persistence_li);

        // popup handlers apparently not actually implemented as of 2012-07-01.
        //var handlers = {opened: function (event, ui) {
        //                    console.log('opened'); },
        //                closed: function (event, ui) {
        //                    console.log("popup closed"); }}
        //$popup.popup(handlers);
        $popup.popup();
        $popup.parent().page();
        $listview.listview('refresh');
        $popup.popup('open');
    }
    // Whitelist this method for use as a mode_opts 'action':
    PublicRootShareNode.prototype.enlisted_room_menu.is_action = true;

    PublicRootShareNode.prototype.add_item_external = function (credentials) {
        /* Visit a specified share room, according to 'credentials' object:
           {username, password}.
           Use this routine only for adding from outside the object - use
           this.add_item(), instead, for internal operation.
        */

        this.job_id += 1;       // Entry
        var share_id = credentials.shareid;
        var room_key = credentials.password;
        var message = (share_id + " / " + room_key);
        var new_share_url = (my.public_shares_root_url
                             + base32.encode_trim(share_id)
                             + "/" + room_key
                             + "/");
        if (is_public_share_room_url(new_share_url)) {
            this.show_status_message(message + " " + _t("already added")); }
        else {
            var $sm = this.show_status_message(_t("Working..."),
                                               'result');
            $sm.hide();
            $sm.delay(1000).fadeIn(2000); // Give time for error to appear.
            return this.add_item(new_share_url); }}

    PublicRootShareNode.prototype.add_item = function (url) {
        /* Visit a specified share room, according its' URL address.
           Return the room object. */
        register_public_share_room_url(url);
        var room = content_node_manager.get(url, cnmgr.get_combo_root());
        room.visit({},
                   {passive: true,
                    notify_callback: this.notify_subvisit_status.bind(this),
                    notify_token: [this.job_id, url]});
        this.subdirs = public_share_room_urls_list();
        return room; }

    PublicRootShareNode.prototype.remove_item_external = function (room_url) {
        /* Omit a non-original share room from persistent and resident memory.
           This is for use from outside of the object. Use .remove_item() for
           internal object operation. */
        this.job_id += 1;
        this.remove_item(room_url); }

    PublicRootShareNode.prototype.remove_item = function (room_url) {
        /* Omit a non-original share room from the persistent and resident
           collections. Returns true if the item was present, else false. */
        if (is_public_share_room_url(room_url)) {
            if (! is_original_share_room_url(room_url)) {
                // Free the nodes.
                content_node_manager.clear_hierarchy(room_url); }
            unregister_public_share_room_url(room_url);
            this.unpersist_item(room_url);
            this.subdirs = public_share_room_urls_list();
            return true; }
        else { return false; }}
    // Whitelist this method for use as a mode_opts 'action':
    PublicRootShareNode.prototype.remove_item.is_action = true;

    OriginalRootShareNode.prototype.clear_item = function (room_url) {
        /* Omit an original share room from the resident collection.
           (The share room is not actually removed on the server.)
           Returns true if the item was present, else false. */
        if (is_original_share_room_url(room_url)) {
            if (! is_public_share_room_url(room_url)) {
                // Free the nodes.
                content_node_manager.clear_hierarchy(room_url); }
            unregister_original_share_room_url(room_url);
            return true; }
        else { return false; }}

    PublicRootShareNode.prototype.persist_item = function (room_url) {
        /* Add a share rooms to the collection persistent non-originals. */
        var persistents = pmgr.get('public_share_urls') || {};
        if (! persistents.hasOwnProperty(room_url)) {
            persistents[room_url] = true;
            pmgr.set("public_share_urls", persistents); }}
    // Whitelist this method for use as a mode_opts 'action':
    PublicRootShareNode.prototype.persist_item.is_action = true;

    PublicRootShareNode.prototype.unpersist_item = function (room_url) {
        /* Omit a non-original share room from the persistent
           collection.  Returns true if the item was present, else false. */
        var persistents = pmgr.get("public_share_urls") || {};
        if (persistents.hasOwnProperty(room_url)) {
            delete persistents[room_url];
            pmgr.set('public_share_urls', persistents);
            return true; }
        else { return false; }}
    // Whitelist this method for use as a mode_opts 'action':
    PublicRootShareNode.prototype.unpersist_item.is_action = true;

    PublicRootShareNode.prototype.is_persisted = function (room_url) {
        var persisteds = persistence_manager.get('public_share_urls') || {};
        return persisteds.hasOwnProperty(room_url); }

    /* ===== Containment ==== */
    /* For content_node_manager.clear_hierarchy() */

    ContentNode.prototype.contained_urls = function () {
        return [].concat(this.subdirs, this.files); }
    RootContentNode.prototype.contained_urls = function () {
        return [].concat(this.storage_devices,
                         this.original_shares, this.shares); }
    RootStorageNode.prototype.contained_urls = function () {
        return [].concat(this.subdirs); }
    FileStorageNode.prototype.contained_urls = function () {
        return []; }
    FileShareNode.prototype.contained_urls = function () {
        return []; }


    /* ==== Provisioning - Data model assimilation of fetched data ==== */

    ContentNode.prototype.provision = function (data, when, mode_opts) {
        /* Populate node with JSON 'data'. 'when' is the data's current-ness.
           'when' should be no more recent than the XMLHttpRequest.
        */
        this.provision_preliminaries(data, when, mode_opts);
        this.provision_populate(data, when, mode_opts); }

    ContentNode.prototype.provision_preliminaries = function (data, when,
                                                              mode_opts) {
        /* Do provisioning stuff generally useful for derived types. */
        if (! when) {
            throw new Error("Node provisioning without reliable time stamp.");
        }
        this.up_to_date(when); }

    ContentNode.prototype.provision_populate = function (data, when,
                                                         mode_opts) {
        /* Stub, must be overridden by type-specific provisionings. */
        error_alert("Not yet implemented",
                    this.emblem
                    + " type-specific provisioning implementation"); }

    ContentNode.prototype.provision_items = function (data_items,
                                                      this_container,
                                                      url_base, url_element,
                                                      trailing_slash,
                                                      fields,
                                                      contents_parent) {
        /* Register data item fields into subnodes of this node:
           'data_items' - the object to iterate over for the data,
           'this_container' - the container into which to place the subnodes,
           'url_base' - the base url onto which the url_element is appended,
           'url_element' - the field name for the url of item within this node,
           'trailing_slash' - true: url is given a trailing slash if absent,
           'fields' - an array of field names for properties to be copied (1),
           'contents_parent' - the node to attribute as the subnodes parent (2).

           (1) Fields are either strings, denoting the same attribute name in
               the data item and subnode, or two element subarrays, with the
               first element being the data attribute name and the second being
               the attribute name for the subnode.
           (2) The contained item's parent is not always this object, eg for
               the content roots. */
        var parent = content_node_manager.get(contents_parent);
        data_items.map(function (item) {
            var url = url_base + item[url_element];
            if (trailing_slash && (url.slice(url.length-1) !== '/')) {
                url += "/"; }
            var subnode = content_node_manager.get(url, parent);
            fields.map(function (field) {
                if (field instanceof Array) {
                    subnode[field[1]] = item[field[0]]; }
                else {
                    if (typeof item[field] !== "undefined") {
                        subnode[field] = item[field]; }}})
            // TODO Scaling - make subdirs an object for hashed lookup.
            if (this_container.indexOf(url) === -1) {
                this_container.push(url); }})}

    RootStorageNode.prototype.provision_populate = function (data, when,
                                                             mode_opts) {
        /* Embody the root storage node with 'data'.
           'when' is time soon before data was fetched. */
        var combo_root = content_node_manager.get_combo_root();
        var url, dev, devdata;

        this.name = my.username;
        // TODO: We'll cook stats when UI is ready.
        this.stats = data["stats"];

        this.subdirs = [];
        this.provision_items(data.devices, this.subdirs,
                             this.url, 'encoded', true,
                             ['name', 'lastlogin', 'lastcommit'],
                             my.combo_root_url);

        this.lastfetched = when; }

    FolderContentNode.prototype.provision_populate = function (data, when) {
        /* Embody folder content items with 'data'.
           'when' is time soon before data was fetched. */

        this.subdirs = [];
        this.provision_items(data.dirs, this.subdirs, this.url, 1, true,
                             [[0, 'name']], this.url);

        if (data.hasOwnProperty('files')) {
            this.files = [];
            var fields = ['name', 'size', 'ctime', 'mtime', 'versions'];
            generic.preview_sizes.map(function (size) {
                /* Add previews, if any, to the fields. */
                if (("preview_" + size) in data.files) {
                    fields.push("preview_" + size); }})
            this.provision_items(data.files, this.files, this.url, 'url', false,
                                 fields, this.url); }

        this.lastfetched = when; }

    OriginalRootShareNode.prototype.provision_populate = function (data, when) {
        /* Embody the root share room with 'data'.
           'when' is time soon before data was fetched. */
        this.subdirs = [];
        var room_base = my.public_shares_root_url + data.share_id_b32 + "/";
        this.provision_items(data.share_rooms, this.subdirs,
                             room_base, 'room_key', true,
                             [['room_name', 'name'],
                              ['room_description', 'description'],
                              'room_key', 'share_id'],
                             my.combo_root_url);
        this.subdirs.map(function (url) {
            /* Ensure the contained rooms urls are registered as originals. */
            register_original_share_room_url(url); });

        this.lastfetched = when; }

    DeviceStorageNode.prototype.provision_populate = function (data, when) {
        /* Embody storage folder items with 'data'.
           'when' is time soon before data was fetched. */
        FolderStorageNode.prototype.provision_populate.call(this, data, when); }
    RoomShareNode.prototype.provision_populate = function (data, when) {
        /* Embody storage folder items with 'data'.
           'when' is time soon before data was fetched. */
        FolderShareNode.prototype.provision_populate.call(this, data,
                                                              when);
        this.name = data.stats.room_name;
        this.description = data.stats.description;
        this.number_of_files = data.stats.number_of_files;
        this.number_of_folders = data.stats.number_of_folders;
        this.firstname = data.stats.firstname;
        this.lastname = data.stats.lastname;
        this.lastfetched = when; }

    FolderStorageNode.prototype.provision_populate = function (data, when) {
        /* Embody storage folder items with 'data'.
           'when' is time soon before data was fetched. */
        FolderContentNode.prototype.provision_populate.call(this, data, when); }
    FolderShareNode.prototype.provision_populate = function (data, when){
        /* Embody share room folder items with 'data'.
           'when' is time soon before data was fetched. */
        FolderContentNode.prototype.provision_populate.call(this, data, when); }
    FileStorageNode.prototype.provision_populate = function (data, when) {
        error_alert("Not yet implemented", "File preview"); }

    ContentNode.prototype.up_to_date = function (when) {
        /* True if provisioned data is considered current.
           Optional 'when' specifies (new) time we were fetched. */
        // The generic case offers no shortcut for determining up-to-date-ness.
        if (when) { this.lastfetched = when; }
        if (! this.lastfetched) { return false; }
        // No intelligence yet.
        return false; }


    /* ==== Content node page presentation ==== */

    ContentNode.prototype.my_page_id = function () {
        /* Set the UI page id, escaping special characters as necessary. */
        return this.url; }
    RootContentNode.prototype.my_page_id = function () {
        return generic.combo_root_page_id; }
    RootStorageNode.prototype.my_page_id = function () {
        return generic.storage_root_page_id; }
    OriginalRootShareNode.prototype.my_page_id = function () {
        return generic.original_shares_root_page_id; }
    PublicRootShareNode.prototype.my_page_id = function () {
        return generic.public_shares_root_page_id; }
    ContentNode.prototype.show = function (chngpg_opts, mode_opts) {
        /* Trigger UI focus on our content layout.
           If mode_opts "passive" === true, don't do a changePage.
         */
        var $page = this.my_page$();
        if ($.mobile.activePage
            && ($.mobile.activePage[0].id !== this.my_page_id())
            && mode_opts
            && (!mode_opts.passive)) {
            // Use $page object so our handler defers to regular jQm traversal:
            $.mobile.changePage($page, chngpg_opts); }
        // Just in case, eg of refresh:
        $.mobile.loading('hide'); }

    PublicRootShareNode.prototype.do_presentation = function (chngpg_opts,
                                                             mode_opts) {
        /* An exceptional, consolidated presentation routine. */
        // For use by this.visit() and this.notify_subvisit_status().
        this.subdirs.sort(content_nodes_by_url_sorter);
        this.layout(mode_opts);
        this.show(chngpg_opts, mode_opts);

        if (mode_opts.notify_callback) {
            mode_opts.notify_callback(true,
                                      mode_opts.notify_token); }}

    ContentNode.prototype.layout = function (mode_opts) {
        /* Deploy content as markup on our page. */
        this.layout_header(mode_opts);
        this.layout_content(mode_opts);
        this.layout_footer(mode_opts); }

    PublicRootShareNode.prototype.layout = function (mode_opts) {
        /* Deploy content as markup on our page. */

        mode_opts.actions_menu_link_creator = this.actions_menu_link.bind(this);
        ContentNode.prototype.layout.call(this, mode_opts);

        var $content_items = this.my_page$().find('.page-content')
        if (this.subdirs.length === 0) {
            $content_items.hide(); }
        else {
            $content_items.show(); }}

    PublicRootShareNode.prototype.show = function (chngpg_opts, mode_opts) {
        /* Deploy content as markup on our page. */
        ContentNode.prototype.show.call(this, chngpg_opts, mode_opts);
        deploy_focus_oneshot('#my_share_id', "pageshow"); }

    RootContentNode.prototype.layout = function (chngpg_opts, mode_opts) {
        /* Do layout arrangements - different than other node types. */
        var $page = this.my_page$();

        this.layout_header(chngpg_opts, mode_opts);
        this.link_to_roots(chngpg_opts, mode_opts);
        // Storage content section:
        // We avoid doing layout of these when not authenticated so the
        // re-presentation of the hidden sections doesn't show through.
        var storage_subdirs = (my.storage_root_url
                               && cnmgr.get(my.storage_root_url,
                                            this).subdirs
                               || [])
        this.layout_content(mode_opts, storage_subdirs, false,
                            '.storage-list');

        // My share rooms section:
        var myshares_subdirs = (my.original_shares_root_url
                                && cnmgr.get(my.original_shares_root_url,
                                             this).subdirs
                                || [])
        this.layout_content(mode_opts, myshares_subdirs, false,
                            '.my-shares-list');

        // Public share rooms section:
        var public_share_urls = public_share_room_urls_list();
        var $public_shares_nonempty = $page.find('.other-content');
        var $public_shares_empty = $page.find('.other-no-content');
        // Show the section or the button depending on whether there's content:
        if (public_share_urls.length === 0) {
            $public_shares_nonempty.hide();
            $public_shares_empty.show(); }
        else {
            $public_shares_empty.hide();
            $public_shares_nonempty.show();
            this.layout_content(mode_opts, public_share_urls, false,
                                '.other-shares-list'); }

        this.layout_footer(mode_opts); }

    ContentNode.prototype.layout_header_fields = function(fields) {
        /* Populate this content node's page header with these fields settings:
           field.title: html (or just text) with the page label;
           left_url: left-hand button URL; if absent left button not changed;
           left_label: text for left-hand button, or empty to hide the button;
                       left_label = "-" => use the login URL;
           right_url: right-hand button URL; if absent right button not changed;
           right_label: text for right-hand button, or empty to hide the button;
        */
        var $header = this.my_page$().find('[data-role="header"]');
        var $label;

        if (fields.hasOwnProperty('title')) {
            $header.find('.header-title').html(elide(fields.title, 25)); }

        if (fields.hasOwnProperty('right_url')) {
            var $right_slot = $header.find('.header-right-slot');
            $right_slot.attr('href', fields.right_url);
            if (fields.hasOwnProperty('right_label')) {
                if (! fields.right_label) {
                    $right_slot.hide(); }
                else {
                    replace_button_text($right_slot, elide(fields.right_label,
                                                           15));
                    $right_slot.show(); }}}

        if (fields.hasOwnProperty('left_url')) {
            var $left_slot = $header.find('.header-left-slot');
            if (fields.left_url === "-") {
                var parsed = $.mobile.path.parseUrl(window.location.href);
                fields.left_url = parsed.hrefNoHash; }
            $left_slot.attr('href', fields.left_url);
            if (fields.hasOwnProperty('left_label')) {
                if (! fields.left_label) {
                    $left_slot.hide(); }
                else {
                    replace_button_text($left_slot, elide(fields.left_label,
                                                          15));
                    $left_slot.show(); }}}}

    RootContentNode.prototype.layout_header = function (mode_opts) {
        /* Do special RootContentNode header layout. */
        var $header = this.my_page$().find('[data-role="header"]');
        var $logout_button = $header.find('.logout-button');
        var $title = $header.find('.header-title');
        $title.text(this.title());
        if (! this.loggedin_ish()) {
            $logout_button.hide(); }
        else {
            $logout_button.show(); }}

    StorageNode.prototype.layout_header = function(mode_opts) {
        /* Fill in typical values for header fields of .my_page$().
           Many storage node types will use these values as is, some will
           replace them.
         */
        var fields = {};
        fields.right_url = ('#' + add_query_param(this.url,
                                                  "refresh", "true", true));
        fields.right_label = "Refresh";
        fields.title = this.title();
        if (this.parent_url) {
            var container = content_node_manager.get(this.parent_url);
            fields.left_url = '#' + this.parent_url;
            fields.left_label = container.name; }
        this.layout_header_fields(fields); }
    RootStorageNode.prototype.layout_header = function(mode_opts) {
        StorageNode.prototype.layout_header.call(this, mode_opts);
        $('#original_shares_root_url').attr('href',
                                            '#' + my.original_shares_root_url);
        $('#public_shares_root_url').attr('href',
                                          '#' + my.public_shares_root_url);
        var $emptiness_message = this.my_page$().find('.emptiness-message');
        (this.subdirs.length === 0
         ? $emptiness_message.show()
         : $emptiness_message.hide()); }


    PublicRootShareNode.prototype.layout_header = function(mode_opts) {
        ShareNode.prototype.layout_header.call(this, mode_opts);
        // Inject a brief description.
        $('#storage_root_url') .attr('href', '#' + my.storage_root_url);
        $('#public_shares_root_url').attr('href',
                                          '#' + my.public_shares_root_url);
        var $adjust_spiel = this.my_page$().find('.adjust-spiel');
        (this.subdirs.length === 0
         ? $adjust_spiel.hide()
         : $adjust_spiel.show()); }

    OriginalRootShareNode.prototype.layout_header = function(mode_opts) {
        ShareNode.prototype.layout_header.call(this, mode_opts);
        // Adjust the description.
        var $emptiness_message = this.my_page$().find('.emptiness-message');
        (this.subdirs.length === 0
         ? $emptiness_message.show()
         : $emptiness_message.hide()); }

    ShareNode.prototype.layout_header = function(mode_opts) {
        /* Fill in header fields of .my_page$(). */
        var fields = {};
        if (this.parent_url) {
            var container = content_node_manager.get(this.parent_url);
            fields.right_url = '#' + add_query_param(this.url,"refresh","true");
            fields.right_label = "Refresh"
            fields.left_url = '#' + this.parent_url;
            fields.left_label = container.name;
            fields.title = this.title(); }
        else {
            fields.right_url = '#' + add_query_param(this.url, "mode", "edit");
            fields.right_label = "Edit";
            fields.left_url = '#' + add_query_param(this.url, 'mode', "add");
            fields.left_label = "+";
            fields.title = "ShareRooms"; }
        this.layout_header_fields(fields); }

    RootShareNode.prototype.layout_header = function(mode_opts) {
        /* Fill in header fields of .my_page$(). */
        ShareNode.prototype.layout_header.call(this, mode_opts);
        var fields = {'right_url': '#' + add_query_param(this.url,
                                                         "mode", "edit"),
                      'right_label': "Edit"};
        this.layout_header_fields(fields); }

    RootContentNode.prototype.link_to_roots = function (chngpg_opts, mode_opts){
        /* Link section headers to the variable root nodes, if the storage
           root is known. (The public root address is static, so hard-coded
           in the HTML.) */

        if (my.storage_root_url) {
            var $storage = $('#my-storage-leader');
            $storage.find('a').attr('href',
                                    '#' + my.storage_root_url);
            var $originals = $('#my-rooms-leader');
            $originals.find('a').attr('href',
                                      '#' + my.original_shares_root_url); }}

    ContentNode.prototype.layout_content = function (mode_opts,
                                                     subdirs,
                                                     files,
                                                     content_items_selector) {
        /* Present this content node by adjusting its DOM data-role="page".
           'mode_opts' adjust various aspects of provisioning and layout.
           'subdirs' is an optional array of urls for contained directories,
             otherwise this.subdirs is used;
           'files' is an optional array of urls for contained files, otherwise
             this.files is used;
           'content_items_selector' optionally specifies the selector for
             the listview to hold the items, via this.my_content_items$().
         */
        var $page = this.my_page$();
	var $content = $page.find('[data-role="content"]');
	var $list = this.my_content_items$(content_items_selector);
        if ($list.children().length) {
            $list.empty(); }

        subdirs = subdirs || this.subdirs;
        var lensubdirs = subdirs ? subdirs.length : 0;
        files = files || this.files;
        var lenfiles = files ? files.length : 0;
        var do_dividers = (lensubdirs + lenfiles) > generic.dividers_threshold;
        var do_filter = (lensubdirs + lenfiles) > generic.filter_threshold;

        function insert_item($item) {
            if ($cursor === $list) { $cursor.append($item); }
            else { $cursor.after($item); }
            $cursor = $item; }
        function conditionally_insert_divider(t) {
            if (do_dividers && t && (t[0].toUpperCase() !== curinitial)) {
                curinitial = t[0].toUpperCase();
                indicator = divider_prefix + curinitial;
                $item = $('<li data-role="list-divider" id="divider-'
                          + indicator + '">' + indicator + '</li>')
                insert_item($item); }}
        function insert_subnode(suburl) {
            var subnode = content_node_manager.get(suburl, this);
            conditionally_insert_divider(subnode.name);
            insert_item(subnode.layout_item$(mode_opts)); }

        if (lensubdirs + lenfiles === 0) {
            $list.append($('<li title="Empty" class="empty-placeholder"/>')
                         .html('<span class="empty-sign ui-btn-text">'
                               + '&empty;</span>')); }
        else {
            var $item;
            var curinitial, divider_prefix, indicator = "";
            var $cursor = $list;

            if (do_filter) { $list.attr('data-filter', 'true'); }
            if (lensubdirs) {
                divider_prefix = "/";
                for (var i=0; i < subdirs.length; i++) {
                    insert_subnode(subdirs[i]); }}
            if (lenfiles) {
                divider_prefix = "";
                for (var i=0; i < files.length; i++) {
                    insert_subnode(files[i]); }}}

        $page.page();
        $list.listview("refresh");
        return $page; }

    FolderContentNode.prototype.layout_item$ = function(mode_opts) {
        /* Return a jQuery object representing a folder-like content item.

           If mode_opts has 'actions_menu_link_creator', apply it to our
           URL to get back a anchor to a context-specific actions menu for
           this item.
         */
        var $anchor = $('<a/>').attr('class', "crushed-vertical");
        $anchor.attr('href', "#" + this.url);
        $anchor.html($('<h4 class="item-title"/>').html(this.name));

        var $it = $('<li/>').append($anchor);

        if (mode_opts
            && mode_opts.hasOwnProperty('actions_menu_link_creator')) {
            $anchor = mode_opts.actions_menu_link_creator(this.url);
            $it.find('a').after($anchor); }

        $it.attr('data-filtertext', this.name);

        return $it; }
    DeviceStorageNode.prototype.layout_item$ = function(mode_opts) {
        /* Return a storage device's description as a jQuery item. */
        return FolderStorageNode.prototype.layout_item$.call(this); }
    FolderStorageNode.prototype.layout_item$ = function(mode_opts) {
        /* Return a storage folder's description as a jQuery item. */
        return FolderContentNode.prototype.layout_item$.call(this, mode_opts); }
    FolderShareNode.prototype.layout_item$ = function(mode_opts) {
        /* Return a share room folder's description as a jQuery item. */
        return FolderContentNode.prototype.layout_item$.call(this, mode_opts); }
    RoomShareNode.prototype.layout_item$ = function(mode_opts) {
        /* Return a share room's description as a jQuery item. */
        var $it = FolderShareNode.prototype.layout_item$.call(this,
                                                              mode_opts);
        var $title = $it.find('.item-title');
        $title.html($title.html()
                    + '<div> <small> <span class="subdued">Share ID:</span> '
                    + this.share_id
                    + ', <span class="subdued">Room Key:</span> '
                    + this.room_key + ' </small> </div>');
        return $it; }
    FileContentNode.prototype.layout_item$ = function(mode_opts) {
        /* Return a file-like content node's description as a jQuery item. */
        var $it = $('<li data-mini="true"/>');
        $it.attr('data-filtertext', this.name);

        var type = classify_file_by_name(this.name);
        var pretty_type = type ? (type + ", ") : "";
        var $details = $('<p>' + pretty_type + bytesToSize(this.size) +'</p>');

        var date = new Date(this.mtime*1000);
        var day_splat = date.toLocaleDateString().split(",");
        var $date = $('<p class="ul-li-aside">'
                      + day_splat[1] + "," + day_splat[2]
                      + " " + date.toLocaleTimeString()
                      +'</p>');
        var $table = $('<table width="100%"/>');
        var $td = $('<td colspan="2"/>').append($('<h4/>').html(this.name));
        $table.append($('<tr/>').append($td));
        var $tr = $('<tr/>');
        $tr.append($('<td/>').append($details).attr('wrap', "none"));
        $tr.append($('<td/>').append($date).attr('align', "right"));
        $table.append($tr);
        var $href = $('<a/>');
        $href.attr('href', this.url);
        $href.attr('class', "crushed-vertical");
        $href.append($table);
        $it.append($href);

        // XXX use classification to select an icon:
        $it.attr('data-icon', "false");

        return $it; }

    FileStorageNode.prototype.layout_item$ = function(mode_opts) {
        /* Return a storage file's description as a jQuery item. */
        return FileContentNode.prototype.layout_item$.call(this, mode_opts); }
    FileShareNode.prototype.layout_item$ = function(mode_opts) {
        /* Return a storage file's description as a jQuery item. */
        return FileContentNode.prototype.layout_item$.call(this, mode_opts); }

    ContentNode.prototype.layout_footer = function(mode_opts) {
        /* Return markup with general and specific legend fields and urls. */
        // XXX Not yet implemented.
    }

    ContentNode.prototype.my_page_from_dom$ = function () {
        /* Return a jquery DOM search for my page, by id. */
        return $('#' + fragment_quote(this.my_page_id())); }
    ContentNode.prototype.my_page$ = function (reinit) {
        /* Return this node's jQuery page object, producing if not present.

           Optional 'reinit' means to discard existing page, if any,
           forcing clone of a new copy.

           If not present, we get a clone of the storage page template, and
           situate the clone after the storage page template.
        */
        if (reinit && this.$page) {
            this.$page.remove();
            delete this.$page; }
        if (! this.$page) {
            var $template = this.get_storage_page_template$();
            if (! $template) {
                error_alert("Missing markup",
                            "Expected page #"
                            + generic.content_page_template_id
                            + " not present."); }
            this.$page = $template.clone();
            this.$page.attr('id', this.my_page_id());
            this.$page.attr('data-url', this.my_page_id());
            // Include our page in the DOM, after the storage page template:
            $template.after(this.my_page$()); }
        return this.$page; }
    RootContentNode.prototype.my_page$ = function () {
        /* Return the special case of the root content nodes actual page. */
        return (this.$page
                ? this.$page
                : (this.$page = $("#" + this.my_page_id()))); }
    PublicRootShareNode.prototype.my_page$ = function () {
        return RootContentNode.prototype.my_page$.call(this); }
    OriginalRootShareNode.prototype.my_page$ = function () {
        return RootContentNode.prototype.my_page$.call(this); }
    RootStorageNode.prototype.my_page$ = function () {
        return RootContentNode.prototype.my_page$.call(this); }

    ContentNode.prototype.my_content_items$ = function (selector) {
        /* Return this node's jQuery contents litview object.
           Optional 'selector' is used, otherwise '.content-items'. */
        return this.my_page$().find(selector || '.content-items'); }
    ContentNode.prototype.get_storage_page_template$ = function() {
        return $("#" + generic.content_page_template_id); }

    ContentNode.prototype.here = function () {
        /* Return the complete address of this content node, as part of the
           application code, not just its JSON url.  */
        return window.location.href.split('#')[0] + '#' + this.url; }

    ContentNode.prototype.title = function () {
        return this.name; }

    RootContentNode.prototype.title = function () {
        return (my.username
                ? this.emblem + ': ' + my.username
                : this.emblem); }

    /* ===== Resource managers ===== */

    var persistence_manager = {
        /* Maintain domain-specific persistent settings, using localStorage.
           - Value structure is maintained using JSON.
           - Use .get(name), .set(name, value), and .remove(name).
           - .keys() returns an array of all stored keys.
           - .length returns the number of keys.
         */
        // NOTE Compat: versions of android < 2.1 do not support localStorage.
        //              They do support gears sqlite. lawnchair would make it
        //              easy to switch between them.
        get: function (name) {
            /* Retrieve the value for 'name' from persistent storage. */
            return JSON.parse(localStorage.getItem(name)); },
        set: function (name, value) {
            /* Preserve name and value in persistent storage.
               Return the settings manager, for chaining. */
            localStorage.setItem(name, JSON.stringify(value));
            return persistence_manager; },
        remove: function (name) {
            /* Delete persistent storage of name. */
            localStorage.removeItem(name); },
        keys: function () { return Object.keys(localStorage); },
        };
    // Gratuitous 'persistence_manager.length' getter, for a technical example:
    persistence_manager.__defineGetter__('length',
                                         function() {
                                             return localStorage.length; });
    var pmgr = persistence_manager;            // Compact name.


    var remember_manager = {
        /* Maintain user account info in persistent storage. */

        // "remember_me" field not in fields, so its setting is retained
        // when remembering is disabled:
        fields: ['username', 'storage_host', 'storage_web_url'],

        unset: function (disposition) {
            /* True if no persistent remember manager settings are found. */
            return persistence_manager.get("remember_me") === null; },
        active: function (disposition) {
            /* Report or set "Remember Me" persistent account info retention.
               'disposition':
                 - activate if truthy,
                 - return status if not passed in, ie undefined,
                 - deactivate otherwise.
               Deactivating entails wiping the retained account info settings.
            */
            if (disposition) {
                return persistence_manager.set("remember_me", true); }
            else if (typeof disposition === "undefined") {
                return persistence_manager.get("remember_me") || false; }
            else {
                remember_manager.fields.map(function (key) {
                    persistence_manager.remove(key); });
                return persistence_manager.set("remember_me", false); }},

        fetch: function () {
            /* Return remembered account info . */
            var got = {};
            remember_manager.fields.map(function (key) {
                got[key] = persistence_manager.get(key); });
            return got; },

        store: function (obj) {
            /* Preserve account info, obtaining specific fields from 'obj'.
               Error is thrown if obj lacks any fields. */
            remember_manager.fields.map(function (key) {
                if (! obj.hasOwnProperty(key)) {
                    throw new Error("Missing field: " + key); }
                persistence_manager.set(key, obj[key]); })},

        remove_storage_host: function () {
            /* How to inhibit auto-login, without losing the convenience of
               a remembered username, in the absence of a way to remove the
               authentication cookies. */
            persistence_manager.remove('storage_host'); },
    };
    var remgr = remember_manager;

    var transit_manager = function () {
        /* Facilities to detect repeated traversals of the same URL.  To
           use, (1) when creating a url for traversal,
               url = tm.distinguish(url)
           handle_content_visit() will recognize repeats within recents_span
           traversals, and let them pass.
        */
        var tm_param_name = "so_transit";
        var recent_transits = [];
        var recents_span = 3;

        function new_distinction() {
            return ''.concat(new Date().getTime()
                             + Math.floor(Math.random() * 1e5)); }
        function is_repeat(distinction) {
            /* Check 'distinction', and register that we've seen it if not
               already registered. */
            if (! distinction) { return false; }
            else if (recent_transits.indexOf(distinction) != -1) {
                return true; }
            else {
                recent_transits.unshift(distinction);
                recent_transits.splice(recents_span);
                return false; }}

        return {
            distinguish_url: function(url) {
                /* Add a query parameter to a url to distinguish it, so it
                   can be recognized on redundant changePage. */
                var distinct = new_distinction();
                var delim = ((url.search('\\?') === -1) ? "?" : "&");
                return url.concat(delim + tm_param_name + "=" + distinct); },
            is_repeat_url: function(url) {
                return is_repeat(query_params(url)[tm_param_name]); },
        }}()
    var tmgr = transit_manager;


    var content_node_manager = function () {
        /* A singleton utility for getting and removing content node objects.
           "Getting" means finding existing ones or else allocating new ones.
        */
        // Type of newly minted nodes are according to get parameters.

        // ???: Cleanup? Remove nodes when ascending above them?
        // ???:
        // - prefetch offspring layer and defer release til 2 layers above.
        // - make fetch of multiple items contingent to device lastcommit time.

        /* Private */
        var by_url = {};

        /* Public */
        return {
            get_combo_root: function () {
                return this.get(my.combo_root_url, null); },

            get: function (url, parent) {
                /* Retrieve a node according to 'url'.
                   'parent' is required for production of new nodes,
                   which are produced on first reference.
                   Provisioning nodes with remote data is done elsewhere,
                   not here.
                 */
                url = url.split('?')[0];             // Strip query string.
                var got = by_url[url];
                if (! got) {

                    // Roots:
                    if (is_content_root_url(url)) {
                        if (is_combo_root_url(url)) {
                            got = new RootContentNode(url, parent); }
                        else if (url === my.storage_root_url) {
                            got = new RootStorageNode(url, parent); }
                        else if (url === my.original_shares_root_url) {
                            got = new OriginalRootShareNode(url, parent); }
                        else if (url === my.public_shares_root_url) {
                            got = new PublicRootShareNode(url, parent); }
                        else {
                            throw new Error("Content model management error");}}

                    // Contents:
                    else if (parent && (is_combo_root_url(parent.url))) {
                        // Content node just below a root:
                        if (is_storage_url(url)) {
                            got = new DeviceStorageNode(url, parent); }
                        else {
                            got = new RoomShareNode(url, parent); }}
                    else if (url.charAt(url.length-1) !== "/") {
                        // No trailing slash.
                        if (is_storage_url(url)) {
                            got = new FileStorageNode(url, parent); }
                        else {
                            got = new FileShareNode(url, parent); }}
                    else {
                        if (is_storage_url(url)) {
                            got = new FolderStorageNode(url, parent); }
                        else {
                            got = new FolderShareNode(url, parent); }
                    }
                    by_url[url] = got;
                }
                return got; },

            free: function (node) {
                /* Remove a content node from index and free it for gc. */
                if (by_url.hasOwnProperty(node.url)) {
                    delete by_url[node.url]; }
                node.free(); },

            clear_hierarchy: function (url) {
                /* Free node at 'url' and its recursively contained nodes. */
                var it = this.get(url);
                var suburls = it.contained_urls();
                for (var i=0; i < suburls.length; i++) {
                    this.clear_hierarchy(suburls[i]); }
                this.free(it); },

            // Expose the by_url registry when debugging:
            bu: (SO_DEBUGGING ? by_url : null),
        }
    }()
    var cnmgr = content_node_manager; // Compact name, for convenience.


    /* ==== Login ==== */

    function go_to_entrance() {
        /* Visit the entrance page. Depending on session state, it might
           present a login challenge or it might present the top-level
           contents associated with the logged-in account. */
        $.mobile.changePage(content_node_manager.get_combo_root().url); }

    function storage_login(login_info, url) {
        /* Login to storage account and commence browsing at devices.
           'login_info': An object with "username" and "password" attrs.
           'url': An optional url, else generic.storage_login_path is used.
           We provide for redirection to specific alternative servers
           by recursive calls. See:
           https://spideroak.com/apis/partners/web_storage_api#Loggingin
        */
        var login_url;
        var server_host_url;
        var parsed;

        if (url
            && (parsed = $.mobile.path.parseUrl(url))
            && ["http:", "https:"].indexOf(parsed.protocol) !== -1) {
            server_host_url = parsed.domain;
            login_url = url; }

        else {
            server_host_url = generic.base_host_url;
            login_url = (server_host_url + generic.storage_login_path); }

        $.ajax({
            url: login_url,
            type: 'POST',
            dataType: 'text',
            data: login_info,
            success: function (data) {
                var match = data.match(/^(login|location):(.+)$/m);
                if (!match) {
                    var combo_root = content_node_manager.get_combo_root();
                    combo_root.show_status_message(
                        error_alert_message(_t('Temporary server failure'),
                                            _t('Please try again later.'))); }
                else if (match[1] === 'login') {
                    if (match[2].charAt(0) === "/") {
                        login_url = server_host_url + match[2]; }
                    else {
                        login_url = match[2]; }
                    storage_login(login_info, login_url); }
                else {
                    // Browser haz auth cookies, we haz relative location.
                    // Go there, and machinery will intervene to handle it.
                    $.mobile.changePage(
                        set_storage_account(login_info['username'],
                                            server_host_url,
                                            match[2])); }
            },

            error: function (xhr) {
                $.mobile.loading('hide');
                var username;
                if (remember_manager.active()
                    && (username = persistence_manager.get('username'))) {
                    $('#my_login_username').val(username); }
                    var combo_root = content_node_manager.get_combo_root();
                combo_root.show_status_message(
                    error_alert_message('Storage login', xhr.status));
                $(document).trigger("error"); }
        }); }

    function storage_logout() {
        /* Conclude storage login, clearing credentials and stored data.
           Wind up back on the main entry page.
         */
        function finish() {
            clear_storage_account();
            if (remember_manager.active()) {
                // The storage server doesn't remove cookies, so we inhibit
                // relogin by removing the persistent info about the
                // storage host. This leaves the username intact as a
                // "remember" convenience for the user.
                remember_manager.remove_storage_host(); }
            go_to_entrance(); }

        var combo_root = content_node_manager.get_combo_root();
        combo_root.veil(true);

        if (! combo_root.loggedin_ish()) {
            // Can't reach logout location without server - just clear and bail.
            finish(); }
        else {
            // SpiderOak's logout url doesn't (as of 2012-06-15) remove cookies!
            $.ajax({url: my.storage_root_url + generic.storage_logout_suffix,
                    type: 'GET',
                    success: function (data) {
                        finish(); },
                    error: function (xhr) {
                        console.log("Logout ajax fault: "
                                    + xhr.status
                                    + " (" + xhr.statusText + ")");
                        finish(); }}); }}

    RootContentNode.prototype.veil = function (conceal, callback) {
        /* If 'conceal' is true, conceal our baudy body.  Otherwise, gradually
           reveal and position the cursor in the username field.
           Optional callback is a function to invoke as part of the un/veiling.
        */
        function do_focus() {
            var $username = $('#my_login_username');
            if ($username.val() === "") { $username.focus(); }
            else { $('#my_login_password').focus(); }}
        function do_focus_and_callback() {
            do_focus();
            if (callback) { callback(); }}
        var selector = '#home [data-role="content"]';
        if (conceal) {
            $(selector).hide(0, callback);
            this.veiled = true; }
        else {
            this.veiled = false;
            // Surprisingly, doing focus before dispatching fadeIn doesn't work.
            // Also, username field focus doesn't *always* work before the
            // delay is done, hence the redundancy.  Sigh.
            $(selector).delay(1000).fadeIn(2500, do_focus_and_callback);
            do_focus(); }}

    function prep_login_form(content_selector, submit_handler, name_field,
                             do_fade) {
        /* Instrument form within 'content_selector' to submit with
           'submit_handler'. 'name_field' is the id of the form field with
           the login name, "password" is assumed to be the password field
           id. If 'do_fade' is true, the content portion of the page will
           be rigged to fade on form submit, and on pagechange reappear
           gradually.  In any case, the password value will be cleared, so
           it can't be reused.
        */
        var $content = $(content_selector);
        var $form = $(content_selector + " form");

        var $password = $form.find('input[name=password]');
        var $name = $form.find('input[name=' + name_field + ']');

        var $submit = $form.find('[type="submit"]');
        var sentinel = new submit_button_sentinel([$name, $password], $submit)
        $name.bind('keyup', sentinel);
        $password.bind('keyup', sentinel);
        $submit.button()
        sentinel();

        var $remember_widget = $form.find('.remember');
        var remembering = remember_manager.active();
        if ($remember_widget.attr('id') === "remember-me") {
            if (remembering && ($remember_widget.val() !== "on")) {
                $remember_widget.val("on");
                // I believe why we need to also .change() is because the
                // presented slider is just tracking the actual select widget.
                $remember_widget.trigger('change'); }
            else if (!remember_manager.unset() && !remembering) {
                $remember_widget.val("off");
                $remember_widget.trigger('change'); }}
        else if ($remember_widget.attr('id') === "retain-visit") {
            var retaining = persistence_manager.get('retaining_visits');
            if (retaining && ($remember_widget.val() !== "on")) {
                $remember_widget.find('option[value="on"]').attr('selected',
                                                                 'selected');
                $remember_widget.val("on");
                $remember_widget.trigger('change'); }
            else if (!retaining && ($remember_widget.val() !== "off")) {
                $remember_widget.val("off");
                $remember_widget.trigger('change'); }}
        else {
            console.error("spideroak:prep_login_form() - Unanticipated form"); }

        var name_field_val = pmgr.get(name_field);
        if (name_field_val
            && ($remember_widget.attr('id') === "remember-me")
            && ($remember_widget.val() === "on")) {
            $name.attr('value',name_field_val); }

        $form.submit(function () {
            $submit.button('disable');
            var $remember_widget = $form.find('.remember');
            var $name = $('input[name=' + name_field + ']', this);
            var $password = $('input[name=password]', this);
            var data = {};
            if (($name.val() === "") || ($password.val() === "")) {
                // Minimal - the submit button sentinel should prevent this.
                return false; }
            data[name_field] = $name.val();
            $name.val("");
            var remember_widget_on = $remember_widget.val() === "on"
            if ($remember_widget.attr('id') === "remember-me") {
                remember_manager.active(remember_widget_on); }
            else if ($remember_widget.attr('id') === "retain-visit") {
                persistence_manager.set('retaining_visits',
                                        remember_widget_on); }
            else {
                console.error("spideroak:prep_login_form()"
                              " - Unanticipated form"); }

            data['password'] = $password.val();
            if (do_fade) {
                var combo_root = content_node_manager.get_combo_root();
                combo_root.veil(true, function() { $password.val(""); });
                var unhide_form_oneshot = function(event, data) {
                    $content.show('fast');
                    $.mobile.loading('hide');
                    $(document).unbind("pagechange", unhide_form_oneshot);
                    $(document).unbind("error", unhide_form_oneshot); }
                $(document).bind("pagechange", unhide_form_oneshot)
                $(document).bind("error", unhide_form_oneshot); }
            else {
                $name.val("");
                $password.val(""); }
            $name.focus();
            submit_handler(data);
            return false; }); }


    /* ==== Public interface ==== */

    // ("public_interface" because "public" is reserved in strict mode.)
    var public_interface = {
        init: function () {
            /* Do preliminary setup and launch into the combo root. */

            // Setup traversal hook:
            establish_traversal_handler();

            my.combo_root_url = generic.combo_root_url;
            var combo_root = content_node_manager.get_combo_root();
            var public_shares = cnmgr.get(my.public_shares_root_url);

            // Properly furnish login form:
            prep_login_form('.nav-login-storage', storage_login,
                            'username', true);
            prep_login_form('.nav-visit-share',
                            public_shares.add_item_external.bind(public_shares),
                            'shareid', false);

            // Hide everything below the banner, for subsequent unveiling:
            combo_root.veil(true);

            // Try a storage account if available from persistent settings
            if (remember_manager.active()) {
                var settings = remember_manager.fetch();
                if (settings.username && settings.storage_host) {
                    set_storage_account(settings.username,
                                        settings.storage_host,
                                        settings.storage_web_url); }}

            // ... and go:
            $.mobile.changePage(combo_root.url); },

    }


    /* ==== Boilerplate ==== */

    ContentNode.prototype.show_status_message = function (html, kind) {
        /* Inject 'html' into the page DOM as a status message. Optional
           'kind' is the status message kind - currently, 'result' and
           'error' have distinct color styles, the default is 'error'.
           Returns a produced $status_message object. */
        kind = kind || 'error';
        var selector = '.' + kind + '-status-message';

        var $page = this.my_page$();
        var $sm = $page.find(selector)
        if ($sm.length > 0) {
            $sm.html(html);
            $sm.listview(); }
        else {
            var $li = $('<li class="status-message crushed-vertical '
                        + kind + '-status-message">');
            $li.html(html);
            $sm = $('<ul data-role="listview" data-theme="c"/>');
            $sm.append($li);
            $page.find('[data-role="header"]').after($sm);
            $sm.listview();
            $sm.show(); }
        return $sm; }

    ContentNode.prototype.remove_status_message = function (kind) {
        /* Remove existing status message of specified 'kind' (default,
           all), if present. */
        var selector = (kind
                        ? '.' + kind + '-status-message'
                        : '.status-message');
        var $page = this.my_page$();
        var $sm = $page.find(selector);

        if ($sm.length !== 0) {
            $sm.remove(); }}

    ContentNode.prototype.toString = function () {
        return "<" + this.emblem + ": " + this.url + ">"; }


    function no_op () { console.log("no-op"); }

    var document_addrs = {
        /* Map specific document fragment addresses from the application
           document to internal functions/methods. */
        logout: storage_logout,
        noop: no_op,
    }

    function internalize_url(obj) {
        /* Return the "internal" version of the 'url'.

           - For non-string objects, returns the object
           - For fragments of the application code's url, returns the fragment
             (sans the '#'),
           - Translates page-ids for root content nodes to their urls,
           - Those last two, combined, transforms fragment references to root
             content pages to the urls of those pages.

           If none of the conditions holds, the original object is returned. */
        if (typeof obj !== "string") { return obj; }
        if (obj.split('#')[0] === window.location.href.split('#')[0]) {
            obj = obj.split('#')[1]; }
        switch (obj) {
        case (generic.combo_root_page_id):
            return generic.combo_root_url;
        case (generic.storage_root_page_id):
            return my.storage_root_url;
        case (generic.original_shares_root_page_id):
            return my.original_shares_root_url;
        case (generic.public_shares_root_page_id):
            return my.public_shares_root_url;
        default: return obj; }}

    function content_nodes_by_url_sorter(prev, next) {
        var prev_str = prev, next_str = next;
        var prev_name = content_node_manager.get(prev).name;
        var next_name = content_node_manager.get(next).name;
        if (prev_name && next_name) {
            prev_str = prev_name, next_str = next_name; }
        if (prev_str < next_str) { return -1; }
        else if (prev_str > next_str) { return 1; }
        else { return 0; }}

    if (SO_DEBUGGING) {
        // Expose the managers for access while debugging:
        public_interface.cnmgr = cnmgr;
        public_interface.pmgr = pmgr; }


    /* ==== Here we go: ==== */
    return public_interface;
}();



    $(document).ready(function () {
    "use strict";               // ECMAScript 5

    // Development convenience: Go back to start page on full document reload.
    // All the internal application state is gone, anyway.
    if (window.location.hash) {
        $.mobile.changePage(window.location.href.split('#')[0]); }

    spideroak.init();
});
