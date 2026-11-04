
window.DuelGame = (() => {
  let game = null, sceneRef = null;
  let state = { localId:null, players:[] };

  const laneX = lane => [0.19,0.5,0.81][lane];
  const riotVersion = "16.21.1";

  const championImage = id =>
    `https://ddragon.leagueoflegends.com/cdn/${riotVersion}/img/champion/${({
      ahri:"Ahri",yasuo:"Yasuo",lux:"Lux",jinx:"Jinx",
      leesin:"LeeSin",zed:"Zed",garen:"Garen",
      missfortune:"MissFortune",katarina:"Katarina",
      ezreal:"Ezreal",ashe:"Ashe",darius:"Darius",
      akali:"Akali",vayne:"Vayne",thresh:"Thresh",
      leona:"Leona",irelia:"Irelia",kaisa:"KaiSa",
      morgana:"Morgana",masteryi:"MasterYi"
    })[id] || "Ahri"}.png`;

  class ArenaScene extends Phaser.Scene {
    constructor(){
      super("Arena");
    }

    preload(){
      window.CHAMPIONS.forEach(c=>{
        this.load.image(`champ-${c.id}`,championImage(c.id));
      });
    }

    create(){
      sceneRef=this;
      this.drawArena();

      this.self=this.makeFighter(0,0,"SEN");
      this.enemy=this.makeFighter(0,0,"RAKİP");

      this.syncPlayers();

      this.scale.on("resize",()=>{
        this.drawArena();
        this.syncPlayers();
      });
    }

    drawArena(){
      const w=this.scale.width,h=this.scale.height;

      if(this.bg)this.bg.destroy(true);
      this.bg=this.add.container(0,0);

      this.bg.add(this.add.rectangle(w/2,h/2,w,h,0x1b141e));

      for(let i=0;i<3;i++){
        const x=w*(i+.5)/3;

        this.bg.add(
          this.add.rectangle(
            x,h/2,w/3-3,h-4,
            [0x30222d,0x382633,0x30222d][i],0.94
          ).setStrokeStyle(1,0x775262,.8)
        );

        this.bg.add(
          this.add.rectangle(x,h/2,2,h-12,0xb08b5c,.12)
        );

        for(let j=0;j<4;j++){
          const y=24+j*(h-48)/3;
          this.bg.add(this.add.circle(x,y,2,0xd4b477,.24));
        }
      }

      this.bg.add(
        this.add.ellipse(w/2,h/2,w*.72,h*.72,0x9b5169,.08)
      );
    }

    makeFighter(x,y,label){
      const c=this.add.container(x,y);

      const shadow=this.add.ellipse(0,12,58,15,0x000000,.5);
      const art=this.add.image(0,-4,"champ-ahri").setDisplaySize(82,82);

      const tag=this.add.text(0,48,label,{
        fontFamily:"Georgia",
        fontSize:"12px",
        fontStyle:"bold",
        color:"#f1dfbd",
        stroke:"#170e16",
        strokeThickness:3
      }).setOrigin(.5);

      c.add([shadow,art,tag]);
      c.setData("art",art);
      return c;
    }

    syncPlayers(){
      const w=this.scale.width,h=this.scale.height;

      const me=state.players.find(p=>p.id===state.localId);
      const foe=state.players.find(p=>p.id!==state.localId);

      if(me){
        this.self.setPosition(w*laneX(me.lane),h*.76);

        const key=`champ-${me.champion||"ahri"}`;
        if(this.textures.exists(key)){
          this.self.getData("art").setTexture(key);
        }
      }

      if(foe){
        this.enemy.setPosition(w*laneX(foe.lane),h*.23);

        const key=`champ-${foe.champion||"ahri"}`;
        if(this.textures.exists(key)){
          this.enemy.getData("art").setTexture(key);
        }
      }
    }

    launch(p){
      const w=this.scale.width,h=this.scale.height;
      const fromLocal=p.fromId===state.localId;

      const x=w*laneX(p.lane);
      const y1=fromLocal?h*.68:h*.32;
      const y2=fromLocal?h*.32:h*.68;

      const champ=window.CHAMPIONS.find(c=>c.id===p.champion);

      const hex=(champ?.colors?.[p.skill==="R"?1:0]||"#80d8ff").replace("#","");
      const color=parseInt(hex,16)||0x80d8ff;

      const accent=parseInt(
        (champ?.colors?.[1]||"#ffd166").replace("#",""),16
      )||0xffd166;

      const warning=this.add.rectangle(
        x,h/2,w/3-8,h-18,0xc92e49,.12
      ).setStrokeStyle(2,0xff627b,.45);

      this.tweens.add({
        targets:warning,
        alpha:0,
        duration:850,
        onComplete:()=>warning.destroy()
      });

      const size=p.skill==="R"?15:({Q:7,W:10,E:8}[p.skill]||7);

      const orb=this.add.circle(x,y1,size,color).setStrokeStyle(2,0xffffff);
      const trail=this.add.circle(x,y1,size*1.8,accent,.2);

      const glyph=this.add.text(x,y1,p.skill,{
        fontFamily:"Georgia",
        fontSize:p.skill==="R"?"17px":"11px",
        fontStyle:"bold",
        color:"#ffffff",
        stroke:"#160e18",
        strokeThickness:3
      }).setOrigin(.5);

      const duration=p.skill==="R"?1350:({Q:780,W:920,E:850}[p.skill]||850);
      const wobble=p.skill==="E"?18:p.skill==="W"?-12:0;

      this.tweens.add({
        targets:[orb,trail,glyph],
        y:y2,
        duration,
        ease:"Sine.easeInOut",
        onUpdate:tw=>{
          const t=tw.progress;
          orb.x=x+Math.sin(t*Math.PI*2)*wobble;
          trail.x=orb.x;
          glyph.x=orb.x;
        },
        onComplete:()=>{
          orb.destroy();
          trail.destroy();
          glyph.destroy();
        }
      });
    }

    impact(data){
      const w=this.scale.width,h=this.scale.height;
      const x=w*laneX(data.lane);
      const y=data.victimId===state.localId?h*.76:h*.23;

      const ring=this.add.circle(
        x,y,18,data.hit?0xff5964:0x8c8c9c,.25
      ).setStrokeStyle(3,data.hit?0xff5964:0xadb5bd);

      this.tweens.add({
        targets:ring,
        scale:2.3,
        alpha:0,
        duration:350,
        onComplete:()=>ring.destroy()
      });

      if(data.hit){
        const txt=this.add.text(x,y-36,`-${data.damage}`,{
          fontFamily:"Inter",
          fontSize:"15px",
          fontStyle:"bold",
          color:"#ffb2a9",
          stroke:"#170e16",
          strokeThickness:3
        }).setOrigin(.5);

        this.tweens.add({
          targets:txt,
          y:txt.y-25,
          alpha:0,
          duration:750,
          onComplete:()=>txt.destroy()
        });
      }
    }
  }

  function start(){
    if(game||!window.Phaser)return;

    game=new Phaser.Game({
      type:Phaser.AUTO,
      parent:"game-container",
      width:360,
      height:330,
      backgroundColor:"#1b141e",
      scale:{
        mode:Phaser.Scale.FIT,
        autoCenter:Phaser.Scale.CENTER_BOTH
      },
      scene:[ArenaScene],
      render:{
        antialias:true,
        pixelArt:false
      }
    });
  }

  function setState(next){
    state={...state,...next};
    if(sceneRef)sceneRef.syncPlayers();
  }

  // Kendi hareketini sunucu cevabını beklemeden göster.
  function predictLane(lane){
    state.players=state.players.map(p=>
      p.id===state.localId ? {...p,lane} : p
    );
    if(sceneRef)sceneRef.syncPlayers();
  }

  function launch(p){
    if(sceneRef)sceneRef.launch(p);
  }

  function impact(d){
    if(sceneRef)sceneRef.impact(d);
  }

  return {
    start,
    setState,
    predictLane,
    launch,
    impact,
    getState:()=>state
  };
})();
