
window.GameNetwork = (() => {
  const socket = io({
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity
  });

  const listeners = new Map();

  socket.on("connect", () => {
    window.dispatchEvent(
      new CustomEvent("net:status",{detail:true})
    );

    const code = sessionStorage.getItem("p2-room-code");
    const token = sessionStorage.getItem("p2-player-token");

    if (code && token) {
      socket.emit("room:resume",{code,token});
    }
  });

  socket.on("disconnect", () => {
    window.dispatchEvent(
      new CustomEvent("net:status",{detail:false})
    );
  });

  socket.onAny((event,...args) => {
    window.dispatchEvent(
      new CustomEvent(`net:${event}`,{detail:args[0]})
    );
  });

  function remember(data) {
    if (data?.code) {
      sessionStorage.setItem("p2-room-code",data.code);
    }

    if (data?.token) {
      sessionStorage.setItem("p2-player-token",data.token);
    }
  }

  socket.on("room:created",remember);
  socket.on("room:joined",remember);
  socket.on("room:resumed",remember);

  return {
    socket,

    on(event,callback) {
      window.addEventListener(`net:${event}`,e=>{
        callback(e.detail);
      });
    },

    createRoom(name) {
      socket.emit("room:create",{
        name:String(name || "").trim().slice(0,16)
      });
    },

    joinRoom(code,name) {
      socket.emit("room:join",{
        code:String(code || "").trim().toUpperCase(),
        name:String(name || "").trim().slice(0,16)
      });
    },

    resume(code,token) {
      socket.emit("room:resume",{code,token});
    },

    selectChampion(id) {
      socket.emit("champion:select",id);
    },

    move(lane) {
      socket.emit("player:move",lane);
    },

    cast(skill,lane) {
      socket.emit("skill:cast",{skill,lane});
    }
  };
})();
