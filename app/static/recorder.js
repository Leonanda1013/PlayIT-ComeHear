// Perekam konsultasi.
// Selama merekam, potongan audio dikirim tiap 5 detik sehingga server menjalankan ASR bertahap.
// Saat Selesai ditekan, halaman review langsung dibuka: dokter mengisi O sementara S disusun.
(function () {
  const visitId = window.VISIT_ID;
  const startBtn = document.getElementById("btn-start");
  const stopBtn = document.getElementById("btn-stop");
  const rec = document.getElementById("rec");
  const timeEl = document.getElementById("rec-time");
  const progress = document.getElementById("progress");
  const uploadForm = document.getElementById("upload-form");
  const STEPS = { recording: "Merekam", queued: "Menunggu antrean", transcribing: "Mengubah suara ke teks (ASR)",
    extracting: "Menyusun bagian S", coding: "Mencari usulan ICD-10", done: "Selesai", failed: "Gagal" };
  let recorder, allChunks = [], startedAt, timer, sessionId = null, seq = 0, chain = Promise.resolve(), liveOk = true;

  function show(msg) { if (progress) { progress.style.display = "block"; progress.textContent = msg; } }

  async function postForm(url, fields, file) {
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) => v !== null && v !== undefined && fd.append(k, v));
    if (file) fd.append(file.name, file.blob, file.filename);
    const r = await fetch(url, { method: "POST", body: fd, headers: { accept: "application/json" } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.detail || r.status);
    return body;
  }

  // Potongan dikirim berurutan (rantai promise); bila gagal, beralih ke unggah utuh di akhir.
  function sendChunk(blob) {
    const n = seq++;
    chain = chain.then(async () => {
      if (!liveOk) return;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const b = await postForm(`/visits/${visitId}/audio-chunk`, { seq: n, session_id: sessionId },
            { name: "chunk", blob, filename: `c${n}.webm` });
          sessionId = b.session_id;
          return;
        } catch (e) {
          if (String(e.message).includes("persetujuan")) { show("Gagal: " + e.message); liveOk = false; return; }
          await new Promise(r => setTimeout(r, 800));
        }
      }
      liveOk = false; // jaringan bermasalah: rekaman tetap disimpan di browser dan diunggah utuh
    });
  }

  async function uploadWhole(blob, filename, started) {
    show("Mengunggah audio…");
    try {
      const b = await postForm(`/visits/${visitId}/audio`, { started_at: started ? started.toISOString() : null },
        { name: "audio", blob, filename });
      location.href = `/visits/${visitId}/review`;
      return b;
    } catch (e) { show("Gagal: " + e.message); }
  }

  if (startBtn) startBtn.onclick = async () => {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, noiseSuppression: true, echoCancellation: true } }); }
    catch (e) { show("Mikrofon tidak bisa dibuka: " + e.message + ". Gunakan unggah berkas."); return; }
    const mime = ["audio/webm;codecs=opus", "audio/webm"].find(m => MediaRecorder.isTypeSupported(m));
    liveOk = !!mime; // Safari (audio/mp4) tidak bisa disambung per potongan: unggah utuh saja
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    allChunks = []; seq = 0; sessionId = null; chain = Promise.resolve();
    recorder.ondataavailable = e => {
      if (!e.data.size) return;
      allChunks.push(e.data);
      if (liveOk) sendChunk(e.data);
    };
    recorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const type = recorder.mimeType || "audio/webm";
      await chain;
      if (liveOk && sessionId) {
        try {
          const b = await postForm(`/visits/${visitId}/audio-finish`, { session_id: sessionId });
          location.href = b.review_url;
          return;
        } catch (e) { /* jatuh ke unggah utuh */ }
      }
      uploadWhole(new Blob(allChunks, { type }), "konsultasi." + (type.includes("mp4") ? "m4a" : "webm"), startedAt);
    };
    recorder.start(5000);
    startedAt = new Date();
    rec.classList.add("on"); startBtn.disabled = true; stopBtn.disabled = false;
    show("Merekam… transkripsi berjalan di latar belakang.");
    timer = setInterval(() => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      timeEl.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    }, 500);
  };

  if (stopBtn) stopBtn.onclick = () => {
    clearInterval(timer); rec.classList.remove("on"); stopBtn.disabled = true;
    show("Menyelesaikan rekaman…");
    recorder && recorder.state !== "inactive" && recorder.stop();
  };

  if (uploadForm) uploadForm.onsubmit = e => {
    e.preventDefault();
    const f = uploadForm.audio.files[0];
    if (f) uploadWhole(f, f.name, null);
  };

  // Sesi yang masih diproses (mis. setelah unggah teks): tampilkan tahapnya, buka review bila S siap.
  const running = document.querySelector('tr[data-session][data-status]:not([data-status="done"]):not([data-status="failed"]):not([data-status="recording"])');
  if (running && progress) (async function poll() {
    const s = await (await fetch(`/api/sessions/${running.dataset.session}`)).json();
    show(`${STEPS[s.status] || s.status}…`);
    if (["coding", "done"].includes(s.status)) { location.href = `/visits/${visitId}/review`; return; }
    if (s.status === "failed") { show("Gagal: " + s.error); return; }
    setTimeout(poll, 1500);
  })();
})();
