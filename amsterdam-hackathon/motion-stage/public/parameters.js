// Shared by the browser and backend. Add numeric scene controls here.
export const commonParameters = {
  characterOpacity: {label:'Character opacity',min:0,max:1,step:0.01,default:1,cc:20},
};
export const sceneParameters = {
  ready: {
    rubberWarp: {label:'Mid · rubber warp',min:0,max:1,step:0.01,default:0.55,cc:21},
    shardFrenzy: {label:'High · shard frenzy',min:0,max:1,step:0.01,default:0.5,cc:22},
  },
  'real-house': {
    characterOpacity: {label:'Low · character opacity',min:0,max:1,step:0.01,default:1,cc:20},
    gridSpread: {label:'Mid · joints → grid',min:0,max:1,step:0.01,default:0,cc:21},
    sphereSize: {label:'High · sphere radius',min:0.015,max:0.22,step:0.001,default:0.065,cc:22},
  },
  'wide-open': {
    characterScale: {label:'Mid · character scale',min:0.5,max:1.5,step:0.01,default:1,cc:21},
    feedbackRate: {label:'High · outline feedback',min:0,max:1,step:0.01,default:0.7,cc:22},
  },
  freestyler: {
    characterOpacity: {label:'Low · outline → shading',min:0,max:1,step:0.01,default:0.6,cc:20},
    printStyle: {label:'Mid · toon contrast / halftone',min:0,max:1,step:0.01,default:0.5,cc:21},
    saleType: {label:'High · FREE STYLE!',min:0,max:1,step:0.01,default:0.8,cc:22},
  },
  'gal-a-bubble': {
    coneColors: {label:'Cone colors',min:0,max:1,step:0.01,default:0.08,cc:21},
    coneIntensity: {label:'Cone intensity',min:0,max:2,step:0.01,default:1,cc:22},
  },
  'first-of-year': {
    cameraOrbitSpeed: {label:'Camera rotation (°/s)',min:-60,max:60,step:1,default:0,cc:24,bipolar:true},
    characterCount: {label:'Character instances',min:1,max:6,step:1,integer:true,default:1,cc:21},
  },
  rumble: {
    particleRate: {label:'Particles / second / hand',min:0,max:800,step:1,default:240,cc:21},
    particleSize: {label:'Particle size',min:0.005,max:0.15,step:0.001,default:0.035,cc:22},
    particleLifetime: {label:'Particle lifetime (s)',min:0.1,max:4,step:0.01,default:1.2,cc:23},
    particleSpeed: {label:'Particle speed (m/s)',min:0,max:3,step:0.01,default:0.65,cc:24},
  },
};
export function parameterDefinitions(scene){return {...commonParameters,...sceneParameters[scene]};}
export function parameterDefaults(scene){return Object.fromEntries(Object.entries(parameterDefinitions(scene)).map(([key,d])=>[key,d.default]));}
