// Layar Pemeriksaan Konsultasi & SOAP.
// - Tab S: persetujuan rekam, perekam (potongan 5 dtk -> ASR bertahap di server), transkrip & draf S
//   yang muncul sendiri. Dokter boleh langsung lanjut ke O-A-P selama draf disusun.
// - Tab O-A-P / Verifikasi: pencarian ICD-10, usulan AI, dan isian S yang menyusul bila belum selesai.
(function () {
  const C = window.CONSULT;
  const $ = id => document.getElementById(id);
  const BARS = 44;

  async function post(url, fields, file) {
    const fd = new FormData();
    Object.entries(fields || {}).forEach(([k, v]) => v !== null && v !== undefined && fd.append(k, v));
    if (file) fd.append(file.name, file.blob, file.filename);
    const r = await fetch(url, { method: "POST", body: fd, headers: { accept: "application/json" } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.detail || r.status);
    return body;
  }
  const fmt = s => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  // ---------- tautan langkah: simpan isian dulu ----------
  document.querySelectorAll("[data-save]").forEach(a => a.addEventListener("click", e => {
    const form = $("s-form") || $("soap-form");
    if (!form || C.locked) return;
    e.preventDefault();
    const act = document.createElement("input");
    act.type = "hidden"; act.name = "action"; act.value = a.href.endsWith("/oap") ? "to_oap" : "to_s";
    form.appendChild(act); form.submit();
  }));

  // ---------- pemantauan draf AI ----------
  let lastN = -1, polling = false, sEditing = false;
  async function poll(onUpdate) {
    if (polling) return;
    polling = true;
    const tick = async () => {
      let st;
      try { st = await (await fetch(`/visits/${C.visit}/scribe`)).json(); } catch (e) { setTimeout(tick, 4000); return; }
      onUpdate(st);
      if (st.status === "done" || st.status === "failed" || st.status === null) { polling = false; return; }
      setTimeout(tick, st.status === "recording" ? 4000 : 2000);
    };
    tick();
  }

  // =====================================================================
  if (C.step === "s") {
    const rec = $("recorder"), statusEl = $("rec-status"), labelEl = $("rec-label"), timeEl = $("rec-time");
    const wave = $("wave"), btnStart = $("btn-start"), btnStop = $("btn-stop"), btnPlay = $("btn-play"),
      btnRedo = $("btn-redo"), mic = $("mic-select");
    const sPill = $("s-pill"), sEmpty = $("s-empty"), sView = $("s-view"), sEdit = $("s-edit"),
      sEditBtn = $("btn-s-edit"), sForm = $("s-form");
    let consent = rec.dataset.consent === "1";
    let recorder, stream, audioCtx, analyser, raf, timer, startedAt, chunks = [], sessionId = rec.dataset.session || null,
      seq = 0, chain = Promise.resolve(), liveOk = true, localUrl = null, player = null;

    for (let i = 0; i < BARS; i++) wave.appendChild(document.createElement("i"));
    const bars = [...wave.children];
    function staticWave() {
      wave.classList.remove("hidden");
      bars.forEach((b, i) => { b.style.height = `${8 + Math.abs(Math.sin(i * 1.7) * Math.cos(i * .45)) * 26}px`; });
    }

    function setRecUI(state) {
      rec.dataset.state = state;
      const show = (el, on) => el.classList.toggle("hidden", !on);
      statusEl.className = "status" + ({ recording: " rec", none: consent ? "" : " off" }[state] || "");
      labelEl.textContent = { none: consent ? "Mikrofon Siap" : "Menunggu Persetujuan", recording: "Merekam",
        saved: "Rekaman Tersimpan", manual: "Mode Manual" }[state];
      show(btnStart, state === "none"); show(mic, state === "none" || state === "recording");
      show(btnStop, state === "recording"); show(btnPlay, state === "saved" && !!(localUrl || rec.dataset.audio));
      show(btnRedo, state === "saved" && consent);
      btnStart.disabled = !consent || C.locked;
      mic.disabled = state === "recording";
      if (state === "saved") { staticWave(); } else if (state === "none" || state === "manual") { wave.classList.add("hidden"); }
    }

    // ---------- panel S ----------
    function setS(mode, text) {
      // mode: empty | listening | composing | draft | manual | failed
      const pills = { empty: ["Menunggu Rekaman", ""], listening: ["Merekam", "bad"], composing: ["Menyusun draf", ""],
        draft: ["Draf AI", "primary"], manual: ["Isi Manual", ""], failed: ["Gagal", "bad"] };
      sPill.textContent = pills[mode][0];
      sPill.className = "pill " + pills[mode][1];
      sForm.classList.toggle("focus", mode === "draft");
      const titles = { empty: ["Belum ada rekaman berlangsung", 'Klik tombol <em>"Mulai Rekam"</em> untuk<br>mencatat Subjektif secara otomatis.'],
        listening: ["Mendengarkan konsultasi", "Subjektif disusun otomatis setelah rekaman selesai."],
        composing: ["Subjektif sedang disusun", "Anda bisa lanjut mengisi O-A-P; draf menyusul otomatis."],
        failed: ["Draf AI tidak tersedia", text || "Rekam ulang atau isi manual."] };
      if (titles[mode]) { $("s-empty-title").textContent = titles[mode][0]; $("s-empty-text").innerHTML = titles[mode][1]; }
      const editing = mode === "manual" || sEditing;
      sEmpty.classList.toggle("hidden", mode === "draft" || editing);
      sView.classList.toggle("hidden", mode !== "draft" || editing);
      sEdit.classList.toggle("hidden", !editing);
      sEdit.disabled = !editing;
      if (mode === "draft" && text !== undefined && !sEditing) { sView.textContent = text; sEdit.value = text; }
      sEditBtn.textContent = (mode === "draft" || sView.textContent.trim()) ? (sEditing ? "Selesai edit" : "Edit rangkuman") : "Isi Manual";
    }
    sEditBtn.onclick = () => {
      sEditing = !sEditing;
      if (!sEditing) sView.textContent = sEdit.value;
      const hasText = (sEdit.value || sView.textContent).trim();
      setS(sEditing ? (hasText ? "draft" : "manual") : (hasText ? "draft" : "empty"));
      if (sEditing) { sEdit.classList.remove("hidden"); sEdit.disabled = false; sEmpty.classList.add("hidden"); sView.classList.add("hidden"); sEdit.focus(); }
    };

    function onScribe(st) {
      if (st.n_segments !== lastN) {
        $("chat-wrap").innerHTML = st.chat_html; lastN = st.n_segments;
        const chat = $("chat"); if (chat && chat.scrollHeight) chat.scrollTop = chat.scrollHeight;
      }
      if (st.summary) setS("draft", st.summary);
      else if (st.status === "failed") setS("failed", st.error);
      else if (st.status === "recording") setS("listening");
      else if (st.status) setS("composing");
      if (st.duration_s && rec.dataset.state === "saved") timeEl.textContent = fmt(st.duration_s);
    }

    // ---------- persetujuan ----------
    document.querySelectorAll("#consent input").forEach(r => r.addEventListener("change", async () => {
      try { await post($("consent").dataset.url, { decision: r.value }); }
      catch (e) { alert(e.message); location.reload(); return; }
      document.querySelectorAll("#consent .radio").forEach(l => l.classList.toggle("checked", l.contains(r)));
      consent = r.value === "setuju";
      rec.dataset.consent = consent ? "1" : "0";
      if (!consent) { setRecUI("manual"); sEditing = true; setS("manual"); sEdit.classList.remove("hidden"); sEdit.disabled = false; }
      else { sEditing = false; setRecUI(rec.dataset.state === "saved" ? "saved" : "none"); setS(sView.textContent.trim() ? "draft" : "empty"); }
    }));

    // ---------- pilihan mikrofon ----------
    async function listMics() {
      try {
        const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audioinput");
        const cur = mic.value;
        mic.innerHTML = devs.map((d, i) => `<option value="${d.deviceId}">${d.label || "Mikrofon " + (i + 1)}</option>`).join("")
          || '<option value="">Mikrofon bawaan</option>';
        if (cur) mic.value = cur;
      } catch (e) { /* biarkan bawaan */ }
    }
    if (navigator.mediaDevices) { listMics(); navigator.mediaDevices.addEventListener?.("devicechange", listMics); }

    // ---------- rekam ----------
    function sendChunk(blob) {
      const n = seq++;
      chain = chain.then(async () => {
        if (!liveOk) return;
        for (let a = 0; a < 3; a++) {
          try {
            const b = await post(`/visits/${C.visit}/audio-chunk`, { seq: n, session_id: n ? sessionId : null },
              { name: "chunk", blob, filename: `c${n}.webm` });
            sessionId = b.session_id; return;
          } catch (e) {
            if (/persetujuan|divalidasi/.test(e.message)) { alert(e.message); liveOk = false; return; }
            await new Promise(r => setTimeout(r, 800));
          }
        }
        liveOk = false; // jaringan bermasalah: rekaman tetap utuh di browser, diunggah sekali di akhir
      });
    }

    function drawWave() {
      const data = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        analyser.getByteFrequencyData(data);
        const step = Math.floor(data.length / BARS / 2) || 1;
        bars.forEach((b, i) => { b.style.height = `${4 + (data[i * step] / 255) * 30}px`; });
        raf = requestAnimationFrame(loop);
      };
      wave.classList.remove("hidden"); loop();
    }

    async function startRecording() {
      if (!consent) return;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: mic.value ? { exact: mic.value } : undefined,
          channelCount: 1, noiseSuppression: true, echoCancellation: true } });
      } catch (e) { alert("Mikrofon tidak bisa dibuka: " + e.message + "\nGunakan Chrome di http://localhost dan izinkan mikrofon."); return; }
      listMics();
      const mime = ["audio/webm;codecs=opus", "audio/webm"].find(m => MediaRecorder.isTypeSupported(m));
      liveOk = !!mime;
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks = []; seq = 0; sessionId = null; chain = Promise.resolve(); lastN = -1;
      if (localUrl) { URL.revokeObjectURL(localUrl); localUrl = null; }
      recorder.ondataavailable = e => { if (e.data.size) { chunks.push(e.data); if (liveOk) sendChunk(e.data); } };
      recorder.onstop = finishRecording;
      audioCtx = new AudioContext();
      analyser = audioCtx.createAnalyser(); analyser.fftSize = 256;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      recorder.start(5000);
      startedAt = Date.now();
      setRecUI("recording"); drawWave(); setS("listening");
      $("chat-wrap").querySelector(".placeholder b")?.replaceChildren("Mendengarkan percakapan…");
      timer = setInterval(() => { timeEl.textContent = fmt((Date.now() - startedAt) / 1000); }, 500);
      setTimeout(() => poll(onScribe), 6000);
    }

    async function finishRecording() {
      stream.getTracks().forEach(t => t.stop());
      cancelAnimationFrame(raf); audioCtx && audioCtx.close();
      const type = recorder.mimeType || "audio/webm";
      const blob = new Blob(chunks, { type });
      localUrl = URL.createObjectURL(blob);
      setRecUI("saved"); setS("composing");
      await chain;
      try {
        if (liveOk && sessionId) await post(`/visits/${C.visit}/audio-finish`, { session_id: sessionId });
        else await post(`/visits/${C.visit}/audio`, {}, { name: "audio", blob, filename: "konsultasi.webm" });
      } catch (e) { setS("failed", "Rekaman gagal dikirim: " + e.message); return; }
      polling = false; poll(onScribe);
    }

    btnStart.onclick = startRecording;
    btnStop.onclick = () => { clearInterval(timer); btnStop.disabled = true; recorder && recorder.state !== "inactive" && recorder.stop(); setTimeout(() => { btnStop.disabled = false; }, 800); };
    btnRedo.onclick = () => {
      if (!confirm("Rekam ulang? Rekaman dan draf Subjektif sebelumnya akan diganti.")) return;
      sEditing = false; sView.textContent = ""; sEdit.value = "";
      timeEl.textContent = "00:00"; setRecUI("none"); startRecording();
    };
    btnPlay.onclick = () => {
      if (!player) {
        player = new Audio(localUrl || rec.dataset.audio);
        player.onended = () => { btnPlay.querySelector("span").textContent = "Putar Ulang"; };
      }
      if (player.paused) { player.play(); btnPlay.querySelector("span").textContent = "Jeda"; }
      else { player.pause(); btnPlay.querySelector("span").textContent = "Putar Ulang"; }
    };

    const up = $("upload-form");
    if (up) up.onsubmit = async e => {
      e.preventDefault();
      const f = up.audio.files[0]; if (!f) return;
      if (!consent) { alert("Pilih persetujuan rekam lebih dulu."); return; }
      try { await post(`/visits/${C.visit}/audio`, {}, { name: "audio", blob: f, filename: f.name }); }
      catch (err) { alert(err.message); return; }
      localUrl = URL.createObjectURL(f); setRecUI("saved"); setS("composing"); polling = false; poll(onScribe);
    };

    // ---------- keadaan awal ----------
    const initial = rec.dataset.state;
    if (!consent && document.querySelector('#consent input[value="menolak"]:checked')) {
      setRecUI("manual"); sEditing = true; setS("manual");
    } else if (initial === "recording") {
      setRecUI("saved"); setS("composing"); // halaman dimuat ulang saat merekam: rekaman di browser terputus
    } else {
      setRecUI(initial);
      if (rec.dataset.duration > 0) timeEl.textContent = fmt(rec.dataset.duration);
      if (sView.textContent.trim()) setS("draft", sView.textContent);
      else setS(initial === "saved" ? "composing" : "empty");
    }
    if (C.pending) poll(onScribe);
    if (C.locked) { btnStart.disabled = true; btnRedo.classList.add("hidden"); }
  }

  // =====================================================================
  // O-A-P dan Verifikasi: ICD-10 dan isian yang menyusul
  function pickIcd(code, display) {
    const prim = document.querySelector('input[name="dx_primary"]');
    const sec = document.querySelector('input[name="dx_secondary"]');
    if (!prim) return;
    if (!prim.value.trim()) { prim.value = `${code} — ${display}`; return; }
    if (prim.value.startsWith(code)) return;
    const codes = sec.value.split(",").map(s => s.trim()).filter(Boolean);
    if (!codes.includes(code)) { codes.push(code); sec.value = codes.join(", "); }
  }

  function renderChips(icd) {
    const box = $("icd-chips");
    if (!box || !icd || !icd.length || box.querySelector(".chip")) return;
    box.innerHTML = '<span class="small muted">Usulan AI:</span>' + icd.map(c =>
      `<button type="button" class="chip" data-code="${c.code}" data-display="${c.display}" title="${c.alasan}">${c.code} · ${c.deskripsi_id}</button>`).join("");
  }
  document.addEventListener("click", e => {
    const chip = e.target.closest(".chip[data-code]");
    if (chip) pickIcd(chip.dataset.code, chip.dataset.display);
  });

  document.querySelectorAll("input.icd").forEach(inp => {
    const wrap = inp.parentElement;
    let list, timerId;
    const close = () => { list && list.remove(); list = null; };
    inp.addEventListener("input", () => {
      clearTimeout(timerId);
      const term = inp.dataset.single ? inp.value.split("—")[0].trim() : inp.value.split(",").pop().trim();
      if (term.length < 2) { close(); return; }
      timerId = setTimeout(async () => {
        const items = await (await fetch(`/api/icd?q=${encodeURIComponent(term)}`)).json();
        close();
        if (!items.length) return;
        list = document.createElement("div"); list.className = "ac";
        list.innerHTML = items.map(it => `<div data-code="${it.code}" data-display="${it.display}"><b>${it.code}</b>${it.display}</div>`).join("");
        list.onmousedown = ev => {
          const d = ev.target.closest("div[data-code]"); if (!d) return;
          ev.preventDefault();
          if (inp.dataset.single) inp.value = `${d.dataset.code} — ${d.dataset.display}`;
          else { const parts = inp.value.split(",").map(s => s.trim()); parts[parts.length - 1] = d.dataset.code; inp.value = parts.filter(Boolean).join(", ") + ", "; }
          close();
        };
        wrap.appendChild(list);
      }, 200);
    });
    inp.addEventListener("blur", () => setTimeout(close, 150));
  });

  if ((C.step === "oap" || C.step === "verifikasi") && C.pending) {
    poll(st => {
      renderChips(st.icd);
      if (C.step === "verifikasi" && st.fields) {
        Object.entries(st.fields).forEach(([k, val]) => {
          const el = document.querySelector(`[name="s_${k}"]`);
          if (el && !el.value.trim()) el.value = val || "";
        });
        const sum = document.querySelector('[name="summary"]');
        if (sum && !sum.value.trim() && st.summary) sum.value = st.summary;
        const w = $("s-wait"); if (w) { w.textContent = "Draf AI"; w.className = "pill primary"; }
      }
    });
  }
})();
