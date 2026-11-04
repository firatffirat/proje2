
window.GameUI = (() => {
  const $ = id => document.getElementById(id);
  let roomCode = null, selectedChampion = null, currentFilter = "Tümü";
  let localLane = 1, targetLane = 1, pendingLane = null;
  let matchEndAt = 0, timerHandle = null, cooldownHandle = null;
  let latestPlayers = [], localStats = {hp:1000,mana:100,damage:0,hits:0};

  const skillSpecs = {
    Q:{mana:15,cd:5},
    W:{mana:20,cd:7},
    E:{mana:25,cd:9},
    R:{mana:50,cd:18}
  };

  const cooldownEnds = {};
  const riotVersion = "16.21.1";

  const championIcon = name =>
    `https://ddragon.leagueoflegends.com/cdn/${riotVersion}/img/champion/${name.replace(/[^A-Za-z]/g,"")}.png`;

  function playerName() {
    const input = $("player-name-input");
    const name = input?.value.trim();

    if (!name) {
      toast("Önce oyuncu adını gir.");
      input?.focus();
      return null;
    }

    return name.slice(0,16);
  }

  function show(name) {
    document.querySelectorAll(".screen").forEach(el=>el.classList.remove("active"));
    $(`screen-${name}`).classList.add("active");
  }

  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(()=>el.classList.remove("show"),2300);
  }

  function message(id,text) {
    $(id).textContent = text || "";
  }

  function setBar(id,value,max) {
    $(id).style.width = `${Math.max(0,Math.min(100,value/max*100))}%`;
  }

  function updateRoom(room) {
    if (!room) return;

    const p1 = room.players?.[0];
    const p2 = room.players?.[1];

    $("lobby-player-1").textContent = p1?.name || (p1 ? "Oyuncu 1" : "Bekleniyor");
    $("lobby-player-2").textContent = p2?.name || (p2 ? "Rakip" : "Rakip bekleniyor");

    $("lobby-ready-1").textContent = p1?.ready ? "HAZIR" : "BEKLİYOR";
    $("lobby-ready-2").textContent = p2?.ready ? "HAZIR" : "BEKLİYOR";

    $("lobby-ready-1").classList.toggle("ready",!!p1?.ready);
    $("lobby-ready-2").classList.toggle("ready",!!p2?.ready);

    $("btn-open-champions").disabled =
      room.players.length !== 2 || room.status !== "waiting";

    message(
      "lobby-message",
      room.players.length === 2
        ? "Rakip bağlandı. Şampiyonunu seç."
        : "Rakibin odaya katılması bekleniyor."
    );
  }

  function renderChampions() {
    const grid = $("champion-grid");
    grid.innerHTML = "";

    const q = $("champion-search").value.trim().toLocaleLowerCase("tr");

    const filtered = window.CHAMPIONS.filter(c => {
      const matchesText = (c.name+" "+c.role).toLocaleLowerCase("tr").includes(q);
      const matchesFilter = currentFilter === "Tümü" || c.role.includes(currentFilter);
      return matchesText && matchesFilter;
    });

    filtered.forEach(c => {
      const card = document.createElement("button");
      card.className = "champion-card" + (selectedChampion === c.id ? " selected" : "");

      const portrait = document.createElement("div");
      portrait.className = "champion-portrait";

      const art = document.createElement("img");
      art.src = championIcon(c.name);
      art.alt = c.name;
      art.loading = "lazy";
      art.onerror = () => { art.style.display = "none"; };

      portrait.append(art);

      const name = document.createElement("strong");
      name.textContent = c.name;

      card.append(portrait,name);
      card.onclick = () => selectCard(c);
      grid.append(card);
    });

    if (!filtered.length) {
      grid.innerHTML = '<p class="message">Şampiyon bulunamadı.</p>';
    }
  }

  function selectCard(c) {
    selectedChampion = c.id;
    renderChampions();

    $("champion-detail").innerHTML = "";

    const title = document.createElement("b");
    title.textContent = `${c.name} · ${c.role}`;

    const meta = document.createElement("span");
    meta.textContent = `Zorluk: ${c.difficulty} · Temel kostüm`;

    const skills = document.createElement("span");
    skills.className = "skill-detail";
    skills.textContent = c.skills.map(s=>`${s.key}: ${s.name}`).join("  ·  ");

    $("champion-detail").append(title,meta,skills);
    $("btn-lock-champion").disabled = false;
    GameAudio.play("ready");
  }

  function renderStats(players) {
    if (!players) return;

    // Sunucudan gelen eski konum, tahmini hareketi geri almasın.
    latestPlayers = players.map(p => {
      if (p.id === GameNetwork.socket.id && pendingLane !== null) {
        return {...p,lane:pendingLane};
      }
      return p;
    });

    const me = latestPlayers.find(p=>p.id===GameNetwork.socket.id);
    const enemy = latestPlayers.find(p=>p.id!==GameNetwork.socket.id);

    if (me) {
      localStats = me;

      if (pendingLane === null) {
        localLane = me.lane;
      }

      $("self-hp").textContent = `${Math.ceil(me.hp)} / 1000`;
      setBar("self-health",me.hp,1000);

      $("mana-value").textContent = `${Math.floor(me.mana)} / 100`;
      setBar("mana-fill",me.mana,100);

      $("damage-stat").textContent = me.damage || 0;
      $("hit-stat").textContent = me.hits || 0;

      updateLaneUI();
    }

    if (enemy) {
      $("enemy-hp").textContent = `${Math.ceil(enemy.hp)} / 1000`;
      setBar("enemy-health",enemy.hp,1000);
    }

    DuelGame.setState({
      localId:GameNetwork.socket.id,
      players:latestPlayers
    });
  }

  function startTimer(ms) {
    clearInterval(timerHandle);
    matchEndAt = Date.now()+ms;

    const tick = () => {
      const left = Math.max(0,matchEndAt-Date.now());
      const sec = Math.ceil(left/1000);

      $("match-timer").textContent =
        `${String(Math.floor(sec/60)).padStart(2,"0")}:${String(sec%60).padStart(2,"0")}`;
    };

    tick();
    timerHandle = setInterval(tick,250);
  }

  function showSkillNames(championId) {
    const champ = window.CHAMPIONS.find(c=>c.id===championId);
    if (!champ) return;

    champ.skills.forEach(s=>{
      $(`skill-${s.key.toLowerCase()}-name`).textContent = s.name;
    });
  }

  function enterBattle(data) {
    show("battle");
    DuelGame.start();

    const me = data.players.find(p=>p.id===GameNetwork.socket.id);
    localLane = me?.lane ?? 1;
    targetLane = localLane;
    pendingLane = null;

    renderStats(data.players);

    const foe = data.players.find(p=>p.id!==GameNetwork.socket.id);

    $("self-champion-name").textContent =
      me?.champion ? window.CHAMPIONS.find(c=>c.id===me.champion)?.name || "SEN" : "SEN";

    $("enemy-champion-name").textContent =
      foe?.champion ? window.CHAMPIONS.find(c=>c.id===foe.champion)?.name || "RAKİP" : "RAKİP";

    showSkillNames(me?.champion);
    updateLaneUI();

    startTimer(data.duration ? data.duration*1000 : (data.remainingMs || 300000));

    GameAudio.startMusic();
    GameAudio.play("ready");

    document.querySelectorAll(".skill").forEach(b=>{
      b.disabled = false;
      b.classList.remove("cooling");
      b.querySelector("em").textContent = "";
    });
  }

  function updateLaneUI() {
    $("current-lane").textContent = ["SOL","ORTA","SAĞ"][localLane]+" ŞERİT";

    document.querySelectorAll(".target").forEach(b=>{
      b.classList.toggle("active",Number(b.dataset.lane)===targetLane);
    });
  }

  function move(delta) {
    const nextLane = Math.max(0,Math.min(2,localLane+delta));
    if (nextLane === localLane) return;

    localLane = nextLane;
    targetLane = nextLane;
    pendingLane = nextLane;

    // Önce ekranda hareket et, sonra sunucuya bildir.
    DuelGame.predictLane(nextLane);
    updateLaneUI();

    GameAudio.play("move");
    GameNetwork.move(nextLane);
  }

  function cast(skill) {
    const spec = skillSpecs[skill];
    const btn = document.querySelector(`.skill[data-skill="${skill}"]`);

    if (!spec || !btn) return;

    if (cooldownEnds[skill] && cooldownEnds[skill] > Date.now()) {
      return toast("Yetenek henüz hazır değil.");
    }

    if ((localStats.mana ?? 100) < spec.mana) {
      return toast("Yeterli mana yok.");
    }

    const me = latestPlayers.find(p=>p.id===GameNetwork.socket.id);

    // Yetenek animasyonunu sunucu cevabından önce başlat.
    DuelGame.launch({
      id:"predicted-"+Date.now(),
      fromId:GameNetwork.socket.id,
      champion:me?.champion,
      skill,
      lane:localLane
    });

    // Yerel mana göstergesini hemen güncelle.
    localStats.mana = Math.max(0,(localStats.mana ?? 100)-spec.mana);
    $("mana-value").textContent = `${Math.floor(localStats.mana)} / 100`;
    setBar("mana-fill",localStats.mana,100);

    GameNetwork.cast(skill,localLane);

    cooldownEnds[skill] = Date.now()+spec.cd*1000;
    btn.classList.add("cooling");

    GameAudio.play(skill==="R" ? "ult" : "cast");

    const label = btn.querySelector("em");

    const tick = () => {
      const left = Math.max(0,cooldownEnds[skill]-Date.now());

      if (left <= 0) {
        btn.classList.remove("cooling");
        label.textContent = "";
        return;
      }

      label.textContent = (left/1000).toFixed(1);
      requestAnimationFrame(tick);
    };

    tick();
  }

  function showResult(data) {
    clearInterval(timerHandle);
    clearInterval(cooldownHandle);
    GameAudio.stopMusic();

    const won = data.winnerId === GameNetwork.socket.id;
    const draw = !!data.draw;

    $("result-title").textContent = draw ? "BERABERE" : won ? "ZAFER" : "MAĞLUBİYET";

    $("result-description").textContent =
      draw ? "Süre doldu. İki şampiyonun canı eşit." :
      won ? "Rakibini alt ettin. Arena senin." :
      "Bu düelloyu rakibin kazandı.";

    const me = data.players.find(p=>p.id===GameNetwork.socket.id);

    $("result-damage").textContent = me?.damage || 0;
    $("result-hits").textContent = me?.hits || 0;

    show("result");
    GameAudio.play(draw ? "lose" : won ? "win" : "lose");
  }

  function bind() {
    $("btn-play").onclick = () => {
      GameAudio.unlock();
      show("rooms");
    };

    $("btn-settings").onclick = () => show("settings");

    document.querySelectorAll("[data-back]").forEach(b=>{
      b.onclick = () => show(b.dataset.back);
    });

    $("btn-create-room").onclick = () => {
      const name = playerName();
      if (!name) return;

      message("room-error","Oda oluşturuluyor...");
      GameNetwork.createRoom(name);
    };

    $("btn-join-room").onclick = () => {
      const name = playerName();
      if (!name) return;

      const code = $("room-code-input").value.trim().toUpperCase();
      if (!code) {
        toast("Oda kodunu gir.");
        return;
      }

      GameNetwork.joinRoom(code,name);
    };

    $("room-code-input").addEventListener("input",e=>{
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"");
    });

    $("btn-copy-code").onclick = () => {
      if (roomCode && navigator.clipboard) {
        navigator.clipboard.writeText(roomCode).then(()=>toast("Oda kodu kopyalandı."));
      } else {
        toast("Oda kodu: "+roomCode);
      }
    };

    $("btn-open-champions").onclick = () => {
      renderChampions();
      show("champions");
    };

    $("champion-search").oninput = renderChampions;

    document.querySelectorAll(".filter").forEach(b=>{
      b.onclick = () => {
        currentFilter = b.dataset.filter;
        document.querySelectorAll(".filter").forEach(x=>{
          x.classList.toggle("active",x===b);
        });
        renderChampions();
      };
    });

    $("btn-lock-champion").onclick = () => {
      if (!selectedChampion) return;

      GameNetwork.selectChampion(selectedChampion);
      $("btn-lock-champion").disabled = true;

      message("champion-message","Şampiyon kilitlendi. Rakibin seçimi bekleniyor...");
    };

    $("btn-move-left").onclick = () => move(-1);
    $("btn-move-right").onclick = () => move(1);

    document.querySelectorAll(".target").forEach(b=>{
      b.onclick = () => {
        targetLane = Number(b.dataset.lane);
        updateLaneUI();
      };
    });

    document.querySelectorAll(".skill").forEach(b=>{
      b.onclick = () => cast(b.dataset.skill);
    });

    $("btn-rematch").onclick = () => {
      sessionStorage.removeItem("p2-room-code");
      sessionStorage.removeItem("p2-player-token");
      location.reload();
    };

    $("btn-home").onclick = () => {
      sessionStorage.removeItem("p2-room-code");
      sessionStorage.removeItem("p2-player-token");
      location.reload();
    };

    $("setting-music").onchange = e=>GameAudio.setMusic(e.target.checked);
    $("setting-sfx").onchange = e=>GameAudio.setSfx(e.target.checked);

    $("setting-volume").oninput = e=>{
      GameAudio.setVolume(Number(e.target.value)/100);
      $("volume-label").textContent = e.target.value+"%";
    };

    document.addEventListener("pointerdown",()=>GameAudio.unlock(),{once:true});
  }

  function init() {
    bind();

    GameNetwork.on("room:created",d=>{
      roomCode = d.code;
      $("btn-copy-code").innerHTML = `${d.code}<small>KOPYALA</small>`;
      show("lobby");
      message("lobby-message","Oda oluşturuldu. Kodu rakibine gönder.");
    });

    GameNetwork.on("room:joined",d=>{
      roomCode = d.code;
      $("btn-copy-code").innerHTML = `${d.code}<small>KOPYALA</small>`;
      show("lobby");
    });

    GameNetwork.on("room:resumed",d=>{
      roomCode = d.code;
      $("btn-copy-code").innerHTML = `${d.code}<small>KOPYALA</small>`;
      if (d.status==="waiting") show("lobby");
    });

    GameNetwork.on("room:update",updateRoom);

    GameNetwork.on("app:error",d=>{
      const msg = d?.message || "Bir hata oluştu.";
      message("room-error",msg);
      toast(msg);
    });

    GameNetwork.on("champion:locked",()=>{
      GameAudio.play("ready");
    });

    GameNetwork.on("match:countdown",d=>{
      message("champion-message",`Rakip hazır. Maç ${d.seconds} saniye içinde başlayacak.`);
    });

    GameNetwork.on("match:start",enterBattle);

    GameNetwork.on("match:resume-state",d=>{
      enterBattle(d);
      toast("Bağlantı yeniden kuruldu.");
    });

    GameNetwork.on("match:resumed",d=>{
      $("disconnect-overlay").classList.add("hidden");
      enterBattle(d);
      toast("Maç devam ediyor.");
    });

    GameNetwork.on("match:paused",()=>{
      $("disconnect-overlay").classList.remove("hidden");
      toast("Bağlantı koptu. 30 saniye bekleniyor.");
    });

    GameNetwork.on("match:state",d=>renderStats(d.players));

    GameNetwork.on("player:moved",d=>{
      const isMe = d.playerId === GameNetwork.socket.id;

      if (isMe) {
        pendingLane = null;
        localLane = d.lane;
        targetLane = d.lane;
      }

      const players = latestPlayers.map(p=>
        p.id===d.playerId ? {...p,lane:d.lane} : p
      );

      latestPlayers = players;

      DuelGame.setState({players});
      if (isMe) updateLaneUI();
    });

    GameNetwork.on("skill:launched",d=>{
      // Kendi yeteneğimiz zaten yerel olarak çizildi.
      if (d.fromId !== GameNetwork.socket.id) {
        DuelGame.launch(d);
      }
    });

    GameNetwork.on("skill:impact",d=>{
      DuelGame.impact(d);
      renderStats(d.players);

      $("battle-feedback").textContent =
        d.hit ? (d.victimId===GameNetwork.socket.id ? "İSABET ALDIN!" : "İSABET!") : "ISKA!";

      GameAudio.play(d.hit ? "hit" : "miss");

      setTimeout(()=>$("battle-feedback").textContent="",850);
    });

    GameNetwork.on("skill:rejected",d=>{
      toast(d?.message || "Yetenek kullanılamadı.");
    });

    GameNetwork.on("player:resources",d=>{
      localStats.mana = d.mana;
      $("mana-value").textContent = `${Math.floor(d.mana)} / 100`;
      setBar("mana-fill",d.mana,100);
    });

    GameNetwork.on("match:finished",showResult);

    window.addEventListener("net:status",e=>{
      $("connection-status").classList.toggle("online",e.detail);
      $("connection-status").querySelector("span").textContent =
        e.detail ? "ÇEVRİM İÇİ" : "BAĞLANTI YOK";
    });
  }

  return {init,show,toast};
})();
