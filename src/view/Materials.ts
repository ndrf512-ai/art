/**
 * Общие материалы сцены. Статическая геометрия получает «запечённый» свет ламп
 * через вершинный атрибут baked (x — лампы бункера, y — уличные фонари):
 * так освещён весь комплекс сразу, а отключение генератора гасит свет одним uniform.
 */
import * as THREE from 'three';
import { camoNetTex, canvasTex, concreteTex, dirtTex, metalTex, sandbagTex, woodTex, type TexSet } from './Textures';

export const lightUniforms = {
  uIndoor: { value: 1 },
  uOutdoor: { value: 0 },
  uLampColor: { value: new THREE.Color(1.0, 0.8, 0.56) },
};

/** Добавляет к материалу излучение от запечённого света. */
export function patchBaked<T extends THREE.Material>(mat: T): T {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uIndoor = lightUniforms.uIndoor;
    shader.uniforms.uOutdoor = lightUniforms.uOutdoor;
    shader.uniforms.uLampColor = lightUniforms.uLampColor;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 baked;\nvarying vec2 vBaked;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBaked = baked;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vBaked;\nuniform float uIndoor;\nuniform float uOutdoor;\nuniform vec3 uLampColor;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uLampColor * (vBaked.x * uIndoor + vBaked.y * uOutdoor);',
      );
  };
  mat.customProgramCacheKey = () => 'baked1';
  return mat;
}

export type MatName =
  | 'wood'
  | 'woodDark'
  | 'metal'
  | 'metalGreen'
  | 'metalGrey'
  | 'rust'
  | 'steel'
  | 'sandbag'
  | 'canvas'
  | 'bedding'
  | 'blanket'
  | 'paper'
  | 'brass'
  | 'rubber'
  | 'black'
  | 'white'
  | 'red'
  | 'concrete'
  | 'bark'
  | 'foliage'
  | 'glass'
  | 'shell'
  | 'shellYellow'
  | 'copper'
  | 'leather'
  | 'dirtPile';

export class Materials {
  readonly black1: THREE.DataTexture;
  wall!: THREE.MeshStandardMaterial;
  floor!: THREE.MeshStandardMaterial;
  ceiling!: THREE.MeshStandardMaterial;
  facade!: THREE.MeshStandardMaterial;
  ground!: THREE.MeshStandardMaterial;
  terrain!: THREE.MeshStandardMaterial;
  camoNet!: THREE.MeshStandardMaterial;
  bulbIn!: THREE.MeshBasicMaterial;
  bulbOut!: THREE.MeshBasicMaterial;
  bulbRed!: THREE.MeshBasicMaterial;
  private outdoor = new Map<MatName, THREE.MeshStandardMaterial>();
  private indoor = new Map<MatName, THREE.MeshStandardMaterial>();
  readonly tex: Record<string, TexSet> = {};

  constructor(readonly cheap = false) {
    this.black1 = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.black1.needsUpdate = true;
    this.build();
  }

  private std(params: THREE.MeshStandardMaterialParameters, indoorVariant = false): THREE.MeshStandardMaterial {
    let m: THREE.MeshStandardMaterial;
    if (this.cheap) {
      // на слабых видеочипах: модель Ламберта и без карт нормалей — втрое дешевле на пиксель
      const { roughness: _r, metalness: _m, normalMap: _n, ...rest } = params;
      m = new THREE.MeshLambertMaterial(rest as THREE.MeshLambertMaterialParameters) as unknown as THREE.MeshStandardMaterial;
    } else m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...params });
    if (indoorVariant) {
      // подавляем небесную подсветку внутри бункера (aoMap действует только на рассеянный свет неба)
      m.aoMap = this.black1;
      m.aoMapIntensity = 0.93;
    }
    return patchBaked(m);
  }

  private build(): void {
    const t = this.tex;
    t.wall = concreteTex([0.66, 0.65, 0.61], 11, { formwork: true, drips: true, dirt: 0.5 });
    t.floor = concreteTex([0.46, 0.45, 0.43], 23, { dirt: 0.9 });
    t.ceiling = concreteTex([0.56, 0.55, 0.52], 37, { formwork: true, dirt: 0.4 });
    t.facade = concreteTex([0.6, 0.6, 0.56], 51, { formwork: true, drips: true, dirt: 1.0 });
    t.dirt = dirtTex(5);
    t.wood = woodTex([0.5, 0.39, 0.26], 3);
    t.woodDark = woodTex([0.3, 0.23, 0.16], 8);
    t.metal = metalTex([0.2, 0.21, 0.2], 13, 0.25);
    t.metalGreen = metalTex([0.3, 0.34, 0.27], 17, 0.4);
    t.metalGrey = metalTex([0.42, 0.44, 0.44], 19, 0.3);
    t.rust = metalTex([0.36, 0.24, 0.16], 29, 0.9);
    t.sandbag = sandbagTex(41);
    t.canvas = canvasTex([0.36, 0.38, 0.28], 43);
    t.blanket = canvasTex([0.36, 0.36, 0.34], 47);

    this.wall = this.std({ map: t.wall.map, normalMap: t.wall.normalMap, vertexColors: true, roughness: 0.93 }, true);
    this.floor = this.std({ map: t.floor.map, normalMap: t.floor.normalMap, vertexColors: true, roughness: 0.82 }, true);
    this.ceiling = this.std({ map: t.ceiling.map, normalMap: t.ceiling.normalMap, vertexColors: true, roughness: 0.95 }, true);
    this.facade = this.std({ map: t.facade.map, normalMap: t.facade.normalMap, vertexColors: true, roughness: 0.95 });
    this.ground = this.std({ map: t.dirt.map, normalMap: t.dirt.normalMap, vertexColors: true, roughness: 0.97 });
    this.terrain = this.std({ map: t.dirt.map, vertexColors: true, roughness: 1 });
    this.camoNet = this.std({ map: camoNetTex(7), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
    this.bulbIn = new THREE.MeshBasicMaterial({ color: 0xffe2a8 });
    this.bulbOut = new THREE.MeshBasicMaterial({ color: 0xffe2a8 });
    this.bulbRed = new THREE.MeshBasicMaterial({ color: 0x300000 });

    const def: Record<MatName, THREE.MeshStandardMaterialParameters> = {
      wood: { map: t.wood.map, normalMap: t.wood.normalMap, roughness: 0.85 },
      woodDark: { map: t.woodDark.map, normalMap: t.woodDark.normalMap, roughness: 0.85 },
      metal: { map: t.metal.map, roughness: 0.55, metalness: 0.55 },
      metalGreen: { map: t.metalGreen.map, roughness: 0.65, metalness: 0.3 },
      metalGrey: { map: t.metalGrey.map, roughness: 0.6, metalness: 0.4 },
      rust: { map: t.rust.map, roughness: 0.9, metalness: 0.2 },
      steel: { color: 0x8a8d8c, roughness: 0.4, metalness: 0.8 },
      sandbag: { map: t.sandbag.map, normalMap: t.sandbag.normalMap, roughness: 1 },
      canvas: { map: t.canvas.map, roughness: 1 },
      bedding: { color: 0x8d8a7c, roughness: 1 },
      blanket: { map: t.blanket.map, roughness: 1 },
      paper: { color: 0xcfc8b0, roughness: 1 },
      brass: { color: 0x9c7a35, roughness: 0.45, metalness: 0.7 },
      rubber: { color: 0x141414, roughness: 0.95 },
      black: { color: 0x0c0c0c, roughness: 0.8 },
      white: { color: 0xc9c7bd, roughness: 0.9 },
      red: { color: 0x7a1c14, roughness: 0.8 },
      concrete: { map: t.facade.map, roughness: 0.95 },
      bark: { color: 0x3a3028, roughness: 1 },
      foliage: { color: 0x26331f, roughness: 1 },
      glass: { color: 0x1a2622, roughness: 0.2, metalness: 0.4 },
      shell: { color: 0x46493f, roughness: 0.5, metalness: 0.5 },
      shellYellow: { color: 0x9a8530, roughness: 0.6, metalness: 0.3 },
      copper: { color: 0x7d4a2c, roughness: 0.45, metalness: 0.7 },
      leather: { color: 0x33241a, roughness: 0.8 },
      dirtPile: { map: t.dirt.map, color: 0x6a5a44, roughness: 1 },
    };
    for (const [name, params] of Object.entries(def) as [MatName, THREE.MeshStandardMaterialParameters][]) {
      this.outdoor.set(name, this.std(params, false));
      this.indoor.set(name, this.std(params, true));
    }
  }

  get(name: MatName, indoor: boolean): THREE.MeshStandardMaterial {
    return (indoor ? this.indoor : this.outdoor).get(name)!;
  }
}
