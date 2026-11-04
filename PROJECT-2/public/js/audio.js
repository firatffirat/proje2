window.GameAudio = (() => {
  let ctx=null, master=null, musicOn=true, sfxOn=true, volume=.5, musicTimer=null, musicStep=0;
  function init(){
    if(ctx)return;
    const Ctx=window.AudioContext||window.webkitAudioContext;
    if(!Ctx)return;
    ctx=new Ctx();master=ctx.createGain();master.gain.value=volume;master.connect(ctx.destination);
  }
  function unlock(){init();if(ctx?.state==="suspended")ctx.resume();}
  function tone(freq,duration,type="sine",gain=.08,when=0){
    if(!ctx||!master)return;
    const osc=ctx.createOscillator(),amp=ctx.createGain();
    osc.type=type;osc.frequency.setValueAtTime(freq,ctx.currentTime+when);
    amp.gain.setValueAtTime(.0001,ctx.currentTime+when);
    amp.gain.exponentialRampToValueAtTime(Math.max(.0002,gain),ctx.currentTime+when+.02);
    amp.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+when+duration);
    osc.connect(amp);amp.connect(master);osc.start(ctx.currentTime+when);osc.stop(ctx.currentTime+when+duration+.04);
  }
  function startMusic(){
    unlock();if(!musicOn||musicTimer)return;
    const notes=[110,146.83,164.81,130.81,98,146.83,174.61,130.81];
    musicTimer=setInterval(()=>{
      if(!musicOn)return;
      const f=notes[musicStep++%notes.length];
      tone(f,1.25,"triangle",.018);
      tone(f*2,.65,"sine",.009,.08);
    },850);
  }
  function stopMusic(){if(musicTimer){clearInterval(musicTimer);musicTimer=null;}}
  function setMusic(v){musicOn=!!v;if(musicOn)startMusic();else stopMusic();}
  function setSfx(v){sfxOn=!!v;}
  function setVolume(v){volume=Math.max(0,Math.min(1,Number(v)));if(master)master.gain.value=volume;}
  function play(kind){
    if(!sfxOn)return;unlock();
    const patterns={
      cast:[440,660],ult:[220,440,880],hit:[160,90],miss:[300],move:[520],ready:[392,523],win:[523,659,784],lose:[330,247]
    };
    (patterns[kind]||[440]).forEach((f,i)=>tone(f,.12,kind==="hit"?"sawtooth":"triangle",.045,i*.07));
  }
  return {unlock,startMusic,stopMusic,setMusic,setSfx,setVolume,play};
})();