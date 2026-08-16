// Live listen: when enabled, poll the transmissions feed and auto-play each new
// transmission as soon as it completes, honoring the filters active on the page.
(function () {
    "use strict";

    var POLL_INTERVAL_MS = 2000;
    var MAX_QUEUE = 20; // drop older backlog beyond this to stay near-real-time

    var feedUrl;
    var $toggle, $pause, $skip, $status, $queueInfo, audio;
    var live = false;
    var paused = false;
    var lastId = 0;
    var queue = [];
    var pollTimer = null;
    var playing = null;

    function baseParams() {
        // forward the page's current column filters to the feed; strip pagination/cursor
        var params = new URLSearchParams(window.location.search);
        params.delete("page");
        params.delete("page_size");
        params.delete("after");
        return params;
    }

    function feedRequestUrl(withCursor) {
        var params = baseParams();
        if (withCursor) {
            params.set("after", String(lastId));
        }
        var qs = params.toString();
        return qs ? feedUrl + "?" + qs : feedUrl;
    }

    function fmtFreq(hz) {
        if (hz >= 1e6) return (hz / 1e6).toFixed(3) + " MHz";
        if (hz >= 1e3) return (hz / 1e3).toFixed(1) + " kHz";
        return hz + " Hz";
    }

    function updateStatus() {
        if (!live) {
            $status.text("");
            $queueInfo.text("");
            return;
        }
        if (playing) {
            var parts = [fmtFreq(playing.frequency)];
            if (playing.group_name) parts.push(playing.group_name);
            if (playing.modulation) parts.push(playing.modulation);
            $status.text("Now playing: " + parts.join(" · "));
        } else {
            $status.text(paused ? "Paused" : "Waiting for transmissions…");
        }
        $queueInfo.text(queue.length ? "(" + queue.length + " queued)" : "");
    }

    function playNext() {
        if (paused || playing || !queue.length) {
            updateStatus();
            return;
        }
        playing = queue.shift();
        audio.src = playing.data_url;
        var p = audio.play();
        if (p && p.catch) {
            p.catch(function () { /* autoplay blocked or fetch/decode error */ });
        }
        updateStatus();
    }

    function advance() {
        playing = null;
        playNext();
    }

    function enqueue(list) {
        // the feed returns newest-first; play them oldest-first
        list = list.slice().sort(function (a, b) { return a.id - b.id; });
        for (var i = 0; i < list.length; i++) {
            queue.push(list[i]);
            if (list[i].id > lastId) {
                lastId = list[i].id;
            }
        }
        if (queue.length > MAX_QUEUE) {
            queue = queue.slice(queue.length - MAX_QUEUE); // keep newest, skip stale backlog
        }
        playNext();
    }

    function poll() {
        $.getJSON(feedRequestUrl(true)).done(function (data) {
            if (live && data && data.transmissions && data.transmissions.length) {
                enqueue(data.transmissions);
            }
        });
    }

    function startLive() {
        live = true;
        paused = false;
        $pause.text("Pause");
        $toggle.removeClass("btn-outline-danger").addClass("btn-danger").text("● Live: ON");
        // this click is the user gesture; touch play() now so the browser unlocks
        // audio playback for the element before the first real src is set
        try {
            var p = audio.play();
            if (p && p.catch) { p.catch(function () {}); }
        } catch (e) { /* no src yet - expected */ }
        // only play transmissions that complete AFTER Live is switched on: seed the
        // cursor from the current newest completed transmission, then start polling
        $.getJSON(feedRequestUrl(false)).done(function (data) {
            if (data && data.transmissions) {
                for (var i = 0; i < data.transmissions.length; i++) {
                    if (data.transmissions[i].id > lastId) {
                        lastId = data.transmissions[i].id;
                    }
                }
            }
        }).always(function () {
            if (!live) return;
            pollTimer = setInterval(poll, POLL_INTERVAL_MS);
        });
        updateStatus();
    }

    function stopLive() {
        live = false;
        paused = false;
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        queue = [];
        playing = null;
        try { audio.pause(); } catch (e) {}
        $pause.text("Pause");
        $toggle.removeClass("btn-danger").addClass("btn-outline-danger").text("○ Live: OFF");
        updateStatus();
    }

    $(function () {
        var $root = $("#live-listen");
        if (!$root.length) return;
        feedUrl = $root.data("feed-url");
        $toggle = $("#live-listen-toggle");
        $pause = $("#live-listen-pause");
        $skip = $("#live-listen-skip");
        $status = $("#live-listen-status");
        $queueInfo = $("#live-listen-queue");
        audio = document.getElementById("live-listen-audio");

        audio.addEventListener("ended", advance);
        audio.addEventListener("error", advance);

        $toggle.on("click", function () {
            if (live) { stopLive(); } else { startLive(); }
        });
        $pause.on("click", function () {
            if (!live) return;
            paused = !paused;
            if (paused) {
                try { audio.pause(); } catch (e) {}
                $pause.text("Resume");
            } else {
                $pause.text("Pause");
                if (playing) { audio.play(); } else { playNext(); }
            }
            updateStatus();
        });
        $skip.on("click", function () {
            if (live) { advance(); }
        });
        updateStatus();
    });
})();
