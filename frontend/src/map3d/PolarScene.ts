/**
 * PolarScene — the 3D rendering layer.
 *
 * Deliberately framework-free: it owns the WebGL context, the camera and every
 * visual layer, and exposes a plain `setInput()` / event-callback surface. The
 * React component (`AntarcticMap`) is the *data* and *UI* layer: it converts
 * store state into a `SceneInput` and draws DOM panels on top. That keeps
 *
 *   3D rendering   → src/map3d/*
 *   data mapping   → src/components/map/AntarcticMap.tsx
 *   UI chrome      → src/components/map/*Hud / panels
 *   interaction    → raycast here, semantics in React
 *
 * strictly separated and testable.
 *
 * Projection note: the scene is built in the same south-polar stereographic
 * plane as the original 2D renderer, so pan/zoom/pick maths, the minimap and
 * the scale bar all keep working unchanged.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { paletteFor, type ScenePalette } from './palette';
import { TERRAIN_EXAGGERATION, TERRAIN_RADIUS_KM, SyntheticRelief, buildTerrain, makeIceTexture, darkTerrainColors, lightTerrainColors, type TerrainResult } from './relief';
import { Ocean } from './ocean';
import { SeaIceLayer, type FieldGrid, type IceMode } from './seaIce';
import { IcebergLayer, type BergSpec } from './icebergs';
import { RouteLayer, type RouteSpec } from './routes';
import { VesselLayer, type VesselSpec } from './vessel';
import { ZoneLayer, type ZoneSpec } from './zones';
import { WeatherLayer, type WindCellSpec } from './weather';
import { OverlayLayer, type EndpointSpec, type HazardMarkerSpec } from './overlays';
import { sceneXZ, xzToGeo, VERTICAL_EXAGGERATION } from './coords';
import { project } from '../lib/projection';

export interface SceneInput {
  theme: 'dark' | 'light';
  layers: {
    seaIce: boolean;
    icebergs: boolean;
    trajectories: boolean;
    risk: boolean;
    weather: boolean;
    routes: boolean;
    graticule: boolean;
  };
  /** primary raster: sea-ice concentration, or forecast σ */
  field: { grid: FieldGrid; values?: number[][] | null; sigma?: number[][] | null; severity?: number[][] | null } | null;
  fieldMode: IceMode;
  /** optional risk-severity raster — its own grid, drawn as a second layer so
   *  the two colour scales never mix (same rule the 2D renderer followed) */
  riskField: { grid: FieldGrid; values?: number[][] | null; sigma?: number[][] | null; severity?: number[][] | null } | null;
  icebergs: BergSpec[];
  routes: RouteSpec[];
  vessel: VesselSpec | null;
  zones: ZoneSpec[];
  wind: WindCellSpec[];
  endpoints: EndpointSpec[];
  hazards: HazardMarkerSpec[];
  /** animation switches — every one communicates information, none is decorative */
  animate: {
    waves: boolean;
    windParticles: boolean;
    routeFlow: boolean;
    pulses: boolean;
  };
  /** km, real vessel length (clamped on screen by the layer) */
  vesselLengthKm: number;
}

export type PickKind = 'iceberg' | 'route' | 'vessel' | 'background' | 'none';

export interface PickResult {
  kind: PickKind;
  id?: string;
  lon?: number;
  lat?: number;
}

export interface CameraState {
  azimuthDeg: number;
  /** 0 = top-down, 90 = horizon */
  tiltDeg: number;
  distanceKm: number;
  centerLon: number;
  centerLat: number;
  topDown: boolean;
}

interface Callbacks {
  /** fires only when the hovered object identity changes */
  onHover: (r: PickResult, x: number, y: number) => void;
  /** fires on every pointer move — position the tooltip via the DOM, not state */
  onPointerMove: (x: number, y: number, under: PickResult) => void;
  onPick: (r: PickResult) => void;
  onCamera: (c: CameraState) => void;
}

const DEFAULT_FOV = 42;
const MIN_DIST = 120;
const MAX_DIST = 15000;

export class PolarScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly relief: SyntheticRelief;

  private container: HTMLElement;
  private cb: Callbacks;
  private palette: ScenePalette;
  private terrain: TerrainResult;
  private ocean: Ocean;
  private iceLayer: SeaIceLayer;
  private riskLayer: SeaIceLayer;
  private bergLayer: IcebergLayer;
  private routeLayer: RouteLayer;
  private vesselLayer: VesselLayer;
  private zoneLayer: ZoneLayer;
  private weatherLayer: WeatherLayer;
  private overlayLayer: OverlayLayer;
  private iceTexture: THREE.Texture;
  private key: THREE.DirectionalLight;
  private fill: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private backdrop: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  /** Scratch for projectToScreen — called once per label per frame. */
  private projectScratch = new THREE.Vector3();
  private clock = new THREE.Clock();
  private input: SceneInput | null = null;
  private size = { w: 1, h: 1 };
  private disposed = false;
  private quality: number;

  /** camera tween */
  private tween: { from: THREE.Vector3; to: THREE.Vector3; fromT: THREE.Vector3; toT: THREE.Vector3; t: number; dur: number } | null = null;

  private pointer = { down: false, x: 0, y: 0, t: 0, moved: false };
  private hoverId: string | null = null;
  private dirty = true;
  private fieldSig = '';
  private riskSig = '';
  private dt = 0.016;
  private lastCamEmit = 0;
  private lastCamKey = '';

  constructor(container: HTMLElement, cb: Callbacks, quality = 1) {
    this.container = container;
    this.cb = cb;
    this.quality = quality;
    this.palette = paletteFor('dark');

    this.renderer = new THREE.WebGLRenderer({
      antialias: quality > 0.7,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'none';
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(DEFAULT_FOV, 1, 1, 60000);
    this.camera.position.set(0, 6000, 4200);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.6;
    this.controls.zoomSpeed = 1.0;
    this.controls.panSpeed = 1.0;
    this.controls.screenSpacePanning = true;
    this.controls.enablePan = true;
    this.controls.enableRotate = true;
    this.controls.enableZoom = true;
    this.controls.minDistance = MIN_DIST;
    this.controls.maxDistance = MAX_DIST;
    this.controls.minPolarAngle = 0.02;
    this.controls.maxPolarAngle = Math.PI * 0.485;
    // Google-maps style free navigation: left-drag pans the chart in
    // screen space (sideways + vertical), right-drag orbits, wheel zooms.
    // One-finger touch pans, two-finger pinch zooms + pans.
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };

    // ── lighting: one low sun for long polar shadows + cool sky fill ──
    this.key = new THREE.DirectionalLight(this.palette.keyLight, this.palette.keyIntensity);
    this.key.position.set(-4200, 3600, -5200);
    this.fill = new THREE.DirectionalLight(this.palette.fillLight, this.palette.fillIntensity);
    this.fill.position.set(3800, 2200, 4600);
    this.hemi = new THREE.HemisphereLight(this.palette.ambient, 0x050d16, this.palette.ambientIntensity);
    this.scene.add(this.key, this.fill, this.hemi);

    this.scene.fog = new THREE.Fog(this.palette.fog, 6000, 20000);

    // ── gradient backdrop (atmosphere above the horizon) ──
    this.backdrop = new THREE.Mesh(
      new THREE.SphereGeometry(28000, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTop: { value: new THREE.Color(0x02060c) },
          uBottom: { value: new THREE.Color(this.palette.fog) },
        },
        vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 uTop; uniform vec3 uBottom; varying vec3 vP;
          void main(){ float h = clamp(vP.y / 28000.0 * 0.5 + 0.5, 0.0, 1.0);
            gl_FragColor = vec4(mix(uBottom, uTop, pow(h, 0.75)), 1.0); }`,
      }),
    );
    this.backdrop.renderOrder = -100;
    this.backdrop.raycast = () => {};
    this.scene.add(this.backdrop);

    // ── world layers ──
    this.relief = new SyntheticRelief();
    this.terrain = buildTerrain(this.relief, darkTerrainColors(), quality);
    this.iceTexture = makeIceTexture(256);
    const tmat = this.terrain.mesh.material as THREE.MeshStandardMaterial;
    tmat.map = this.iceTexture;
    tmat.bumpMap = this.iceTexture;
    tmat.bumpScale = 1.4;
    tmat.needsUpdate = true;
    this.scene.add(this.terrain.mesh);

    this.ocean = new Ocean(this.terrain.distanceTexture, this.palette);
    this.scene.add(this.ocean.mesh);

    this.iceLayer = new SeaIceLayer();
    this.scene.add(this.iceLayer.group);
    this.riskLayer = new SeaIceLayer();
    this.scene.add(this.riskLayer.group);
    this.bergLayer = new IcebergLayer(this.palette);
    this.scene.add(this.bergLayer.group);
    this.routeLayer = new RouteLayer();
    this.scene.add(this.routeLayer.group);
    this.vesselLayer = new VesselLayer(this.palette);
    this.scene.add(this.vesselLayer.group);
    this.zoneLayer = new ZoneLayer();
    this.scene.add(this.zoneLayer.group);
    this.weatherLayer = new WeatherLayer(this.palette);
    this.scene.add(this.weatherLayer.group);
    this.overlayLayer = new OverlayLayer();
    this.scene.add(this.overlayLayer.group);

    // ── events ──
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointerleave', this.onPointerLeave);

    this.resize();
    this.clock.start();
    this.renderer.setAnimationLoop(this.tick);
  }

  // ── sizing ──────────────────────────────────────────────────────────

  private pixelRatio() {
    return Math.min(window.devicePixelRatio || 1, this.quality >= 1 ? 2 : 1.35);
  }

  resize() {
    const r = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.floor(r.width));
    const h = Math.max(1, Math.floor(r.height));
    if (w === this.size.w && h === this.size.h) return;
    this.size = { w, h };
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(w, h, false);
    this.weatherLayer.setPixelRatio(this.pixelRatio());
    this.dirty = true;
  }

  get width() { return this.size.w; }
  get height() { return this.size.h; }

  // ── data ────────────────────────────────────────────────────────────

  setInput(input: SceneInput) {
    const themeChanged = !this.input || this.input.theme !== input.theme;
    this.input = input;
    if (themeChanged) this.applyTheme(input.theme);

    // the raster is the only payload expensive enough to need its own gate:
    // geometry is rebuilt on a grid change, pixels are re-uploaded on a data
    // change, and neither happens on an ordinary frame.
    const f = input.layers.seaIce ? input.field : null;
    const g = f?.grid;
    const v = f?.values;
    const sig = f
      ? `${g!.lon0}|${g!.lat0}|${g!.dLon}|${g!.dLat}|${g!.nLon}|${g!.nLat}|${input.fieldMode}|` +
        `${v ? v[0][0] : 'x'}:${v ? v[g!.nLat - 1][g!.nLon - 1] : 'x'}|` +
        `${f.severity ? f.severity[0][0] : 'x'}|${f.sigma ? f.sigma[0][0] : 'x'}`
      : 'none';
    if (sig !== this.fieldSig) {
      this.fieldSig = sig;
      this.iceLayer.update(f, input.fieldMode, this.palette, input.animate.pulses ? 1 : 0.45);
    }

    const rf = input.layers.risk ? input.riskField : null;
    const rg = rf?.grid;
    const rv = rf?.severity;
    const rsig = rf
      ? `${rg!.lon0}|${rg!.lat0}|${rg!.dLon}|${rg!.dLat}|${rg!.nLon}|${rg!.nLat}|` +
        `${rv ? rv[0][0] : 'x'}:${rv ? rv[rg!.nLat - 1][rg!.nLon - 1] : 'x'}`
      : 'none';
    if (rsig !== this.riskSig) {
      this.riskSig = rsig;
      this.riskLayer.update(rf, 'SEVERITY', this.palette, input.animate.pulses ? 1 : 0.45);
    }
    this.dirty = true;
  }

  /** Push the current input through every layer once (after resize/theme too). */
  private syncLayers() {
    const input = this.input;
    if (!input) return;
    const kmPerPx = this.kmPerPixel();
    const t = this.clock.elapsedTime;
    const heightAt = (x: number, z: number) => this.relief.heightKm(x, z);

    this.bergLayer.update(input.icebergs, {
      visible: input.layers.icebergs,
      trajectories: input.layers.trajectories,
      predictions: input.layers.trajectories,
      kmPerPixel: kmPerPx,
      cameraDistance: this.controls.getDistance(),
      palette: this.palette,
      time: t,
      minScreenPx: 15,
    });
    this.routeLayer.update(input.routes, {
      visible: input.layers.routes,
      palette: this.palette,
      time: t,
      kmPerPixel: kmPerPx,
      heightAt,
      liftKm: 2.4,
      exaggeration: VERTICAL_EXAGGERATION,
    });
    this.vesselLayer.update(input.vessel, {
      palette: this.palette,
      kmPerPixel: kmPerPx,
      minScreenPx: 26,
      time: t,
      surfaceY: (x, z) => Math.max(0, heightAt(x, z)) * VERTICAL_EXAGGERATION,
      exaggeration: VERTICAL_EXAGGERATION,
    });
    this.zoneLayer.update(input.zones, {
      visible: input.layers.risk, palette: this.palette, time: t,
    });
    this.weatherLayer.update(input.wind, {
      visible: input.layers.weather,
      particles: input.animate.windParticles,
      palette: this.palette,
      time: t,
      dt: this.dt,
      heightAt,
      exaggeration: VERTICAL_EXAGGERATION,
      kmPerPixel: kmPerPx,
    });
    this.overlayLayer.setGraticule(input.layers.graticule, this.palette, heightAt, VERTICAL_EXAGGERATION);
    this.overlayLayer.updateEndpoints(
      input.endpoints, this.palette, heightAt, VERTICAL_EXAGGERATION, Math.max(5, kmPerPx * 9),
    );
    this.overlayLayer.updateHazards(
      input.hazards, this.palette, heightAt, VERTICAL_EXAGGERATION,
      Math.max(5, kmPerPx * 9), t,
    );
  }

  private tick = () => {
    if (this.disposed) return;
    this.dt = Math.min(0.05, this.clock.getDelta() || 0.016);
    const t = this.clock.elapsedTime;

    this.updateTween(this.dt);
    this.controls.update();
    this.backdrop.position.copy(this.camera.position);

    const a = this.input?.animate;
    this.ocean.update(t, a?.waves ?? false);
    this.ocean.setLight(this.key.position.clone().normalize());

    // Layers are re-synced only when something actually changed; the animated
    // bits (ocean, pulses, flow, particles) advance every frame on their own.
    if (this.dirty) {
      this.syncLayers();
      this.dirty = false;
    }

    // adaptive fog: misty horizon when tilted, clean chart when top-down
    const d = this.controls.getDistance();
    const fog = this.scene.fog as THREE.Fog;
    fog.near = d * 1.15;
    fog.far = d * 3.4;

    this.renderer.render(this.scene, this.camera);
    this.emitCameraThrottled();
  };

  /** Camera readouts drive DOM instruments — 10 Hz is plenty and keeps React calm. */
  private emitCameraThrottled() {
    const now = performance.now();
    if (now - this.lastCamEmit < 100) return;
    const st = this.cameraState();
    const key = `${st.azimuthDeg.toFixed(1)}|${st.tiltDeg.toFixed(1)}|${st.distanceKm.toFixed(0)}|${st.centerLat.toFixed(3)}|${st.centerLon.toFixed(3)}`;
    if (key === this.lastCamKey) return;
    this.lastCamKey = key;
    this.lastCamEmit = now;
    this.cb.onCamera(st);
  }

  // ── theme ───────────────────────────────────────────────────────────

  private applyTheme(theme: 'dark' | 'light') {
    this.palette = paletteFor(theme);
    const p = this.palette;
    (this.backdrop.material as THREE.ShaderMaterial).uniforms.uBottom.value.set(p.fog);
    (this.backdrop.material as THREE.ShaderMaterial).uniforms.uTop.value.set(
      theme === 'light' ? 0x8fb4d0 : 0x02060c,
    );
    (this.scene.fog as THREE.Fog).color.set(p.fog);
    this.key.color.set(p.keyLight);
    this.key.intensity = p.keyIntensity;
    this.fill.color.set(p.fillLight);
    this.fill.intensity = p.fillIntensity;
    this.hemi.color.set(p.ambient);
    this.hemi.intensity = p.ambientIntensity;
    this.hemi.groundColor.set(theme === 'light' ? 0xb9cddd : 0x050d16);
    this.ocean.setPalette(p);
    this.bergLayer.setPalette(p);
    this.vesselLayer.setPalette(p);
    this.weatherLayer.setPalette(p);

    // recolour the terrain in place — rebuilding 200 k vertices on a theme
    // toggle would stall the frame for no reason
    this.terrain.recolor(theme === 'light' ? lightTerrainColors() : darkTerrainColors());
    this.renderer.toneMappingExposure = theme === 'light' ? 1.0 : 1.05;
    this.dirty = true;
  }

  // ── camera ──────────────────────────────────────────────────────────

  kmPerPixel(): number {
    const d = this.controls.getDistance();
    return (2 * d * Math.tan((this.camera.fov * Math.PI) / 360)) / this.size.h;
  }

  private updateTween(dt: number) {
    if (!this.tween) return;
    this.tween.t += dt / this.tween.dur;
    const k = Math.min(1, this.tween.t);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    this.camera.position.lerpVectors(this.tween.from, this.tween.to, e);
    this.controls.target.lerpVectors(this.tween.fromT, this.tween.toT, e);
    if (k >= 1) this.tween = null;
  }

  private startTween(toPos: THREE.Vector3, toTarget: THREE.Vector3, dur = 0.9) {
    this.tween = {
      from: this.camera.position.clone(),
      to: toPos.clone(),
      fromT: this.controls.target.clone(),
      toT: toTarget.clone(),
      t: 0,
      dur,
    };
  }

  /**
   * Orbit distance that renders `pxPerKm` pixels per kilometre at the target —
   * the 3D equivalent of the old `view.scale`, so "zoom to at least 0.5 px/km"
   * requests keep their meaning.
   */
  distanceForScale(pxPerKm: number): number {
    const kmPerPx = 1 / Math.max(0.001, pxPerKm);
    const vFov = (this.camera.fov * Math.PI) / 180;
    return THREE.MathUtils.clamp(
      (kmPerPx * this.size.h) / (2 * Math.tan(vFov / 2)), MIN_DIST, MAX_DIST,
    );
  }

  /** Fly the camera to a lon/lat, optionally setting the orbit distance. */
  flyTo(lon: number, lat: number, distKm?: number, keepAngles = true) {
    const p = project(lon, lat);
    const target = new THREE.Vector3(p.x, 0, p.y);
    const dist = Math.max(MIN_DIST, Math.min(MAX_DIST, distKm ?? this.controls.getDistance()));
    let dir: THREE.Vector3;
    if (keepAngles) {
      dir = this.camera.position.clone().sub(this.controls.target).normalize();
    } else {
      // default 3D mission-control perspective: tilted, looking from the north
      dir = new THREE.Vector3(0.12, 0.62, 0.78).normalize();
    }
    this.startTween(target.clone().add(dir.multiplyScalar(dist)), target);
  }

  /** Fit a set of lon/lat points into the view. */
  framePoints(pts: { lon: number; lat: number }[], padding = 1.5, keepAngles = true) {
    if (pts.length === 0) return;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
      const w = project(p.lon, p.lat);
      minX = Math.min(minX, w.x); maxX = Math.max(maxX, w.x);
      minZ = Math.min(minZ, w.y); maxZ = Math.max(maxZ, w.y);
    }
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const spanX = maxX - minX;
    const spanZ = maxZ - minZ;
    const vFov = (this.camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const dist = Math.max(
      (spanX * padding) / (2 * Math.tan(hFov / 2)),
      (spanZ * padding) / (2 * Math.tan(vFov / 2)),
      MIN_DIST * 1.4,
    );
    const target = new THREE.Vector3(cx, 0, cz);
    const dir = keepAngles
      ? this.camera.position.clone().sub(this.controls.target).normalize()
      : new THREE.Vector3(0.12, 0.62, 0.78).normalize();
    this.startTween(target.clone().add(dir.multiplyScalar(Math.min(MAX_DIST, dist))), target);
  }

  /** Clean top-down polar chart view. */
  setTopDown(on: boolean, distKm?: number) {
    const d = Math.max(MIN_DIST, Math.min(MAX_DIST, distKm ?? this.controls.getDistance()));
    const target = this.controls.target.clone();
    const pos = target.clone().add(new THREE.Vector3(0, d, on ? 0.0001 : d * 0.62));
    this.startTween(pos, target);
    this.controls.enableRotate = !on;
  }

  setTopDownLock(on: boolean) {
    this.controls.enableRotate = !on;
  }

  rotateBy(deg: number) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const sph = new THREE.Spherical().setFromVector3(offset);
    sph.theta += (deg * Math.PI) / 180;
    this.startTween(this.controls.target.clone().add(new THREE.Vector3().setFromSpherical(sph)), this.controls.target.clone(), 0.35);
  }

  setTilt(tiltDeg: number) {
    const polar = THREE.MathUtils.clamp(((90 - tiltDeg) * Math.PI) / 180, this.controls.minPolarAngle, this.controls.maxPolarAngle);
    const offset = this.camera.position.clone().sub(this.controls.target);
    const sph = new THREE.Spherical().setFromVector3(offset);
    sph.phi = polar;
    this.startTween(this.controls.target.clone().add(new THREE.Vector3().setFromSpherical(sph)), this.controls.target.clone(), 0.4);
  }

  zoomBy(factor: number) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const len = THREE.MathUtils.clamp(offset.length() / factor, MIN_DIST, MAX_DIST);
    this.startTween(this.controls.target.clone().add(offset.setLength(len)), this.controls.target.clone(), 0.28);
  }

  panByPixels(dx: number, dy: number) {
    const km = this.kmPerPixel();
    const t = this.controls.target.clone();
    t.x += dx * km;
    t.z += dy * km;
    const offset = this.camera.position.clone().sub(this.controls.target);
    this.startTween(t.clone().add(offset), t, 0.2);
  }

  reset() {
    this.framePoints([
      { lon: 60, lat: -57.5 },
      { lon: 76.19, lat: -69.35 },
      { lon: 86, lat: -68 },
      { lon: 56, lat: -60 },
    ], 1.7, false);
    this.controls.enableRotate = true;
  }

  cameraState(): CameraState {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const sph = new THREE.Spherical().setFromVector3(offset);
    const g = xzToGeo(this.controls.target.x, this.controls.target.z);
    const tilt = 90 - (sph.phi * 180) / Math.PI;
    return {
      azimuthDeg: ((sph.theta * 180) / Math.PI + 360) % 360,
      tiltDeg: tilt,
      distanceKm: sph.radius,
      centerLon: g.lon,
      centerLat: g.lat,
      topDown: tilt > 87,
    };
  }

  /** World → screen px for DOM labels. Returns null when behind the camera. */
  /**
   * World → screen pixels. Accepts anything with x/y/z (a Vector3, or the
   * plain object the DOM label layer uses) so callers outside the 3D chunk do
   * not need to import three.js. Reuses one scratch vector: this runs once per
   * label per frame.
   */
  projectToScreen(v: { x: number; y: number; z: number }): { x: number; y: number } | null {
    const p = this.projectScratch.set(v.x, v.y, v.z).project(this.camera);
    if (p.z > 1) return null;
    return { x: (p.x * 0.5 + 0.5) * this.size.w, y: (-p.y * 0.5 + 0.5) * this.size.h };
  }

  /**
   * Scene anchor for a lon/lat, sitting on the terrain/water surface. Used by
   * the DOM label layer so callouts track their object exactly.
   */
  worldAnchor(lon: number, lat: number, liftKm = 0): THREE.Vector3 {
    const sp = sceneXZ(lon, lat);
    const y = Math.max(0, this.relief.heightKm(sp.x, sp.z)) * VERTICAL_EXAGGERATION + liftKm;
    return new THREE.Vector3(sp.x, y, sp.z);
  }

  /** True relief (km, un-exaggerated) at a lon/lat — for honest readouts. */
  elevationKmAt(lon: number, lat: number): number {
    const sp = sceneXZ(lon, lat);
    return this.relief.heightKm(sp.x, sp.z);
  }

  vesselAnchor(): THREE.Vector3 | null {
    return this.vesselLayer.visible ? this.vesselLayer.anchor() : null;
  }

  routeAnchor(id: string): THREE.Vector3 | null {
    return this.routeLayer.anchorFor(id);
  }

  // ── picking ─────────────────────────────────────────────────────────

  private pick(clientX: number, clientY: number): PickResult {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);

    const targets: THREE.Object3D[] = [];
    if (this.input?.layers.icebergs) targets.push(this.bergLayer.pickTarget());
    if (this.input?.vessel) targets.push(...this.vesselLayer.pickTargets());
    if (this.input?.layers.routes) targets.push(...this.routeLayer.pickables());

    const hits = this.raycaster.intersectObjects(targets, false);
    for (const h of hits) {
      if (h.object.userData.routeId) return { kind: 'route', id: h.object.userData.routeId as string };
      if (h.object.name === 'vessel-hull') return { kind: 'vessel' };
      if (h.instanceId !== undefined) {
        const id = this.bergLayer.idAt[h.instanceId];
        if (id) return { kind: 'iceberg', id };
      }
    }
    // fall through to the terrain / sea surface
    const ground = this.raycaster.intersectObject(this.terrain.mesh, false);
    if (ground.length) {
      const g = xzToGeo(ground[0].point.x, ground[0].point.z);
      return { kind: 'background', lon: g.lon, lat: g.lat };
    }
    const sea = this.raycaster.intersectObject(this.ocean.mesh, false);
    if (sea.length) {
      const g = xzToGeo(sea[0].point.x, sea[0].point.z);
      return { kind: 'background', lon: g.lon, lat: g.lat };
    }
    return { kind: 'none' };
  }

  private onPointerDown = (e: PointerEvent) => {
    this.pointer.down = true;
    this.pointer.moved = false;
    this.pointer.x = e.clientX;
    this.pointer.y = e.clientY;
    this.pointer.t = performance.now();
  };

  private onPointerMove = (e: PointerEvent) => {
    if (this.pointer.down) {
      if (Math.abs(e.clientX - this.pointer.x) > 4 || Math.abs(e.clientY - this.pointer.y) > 4) {
        this.pointer.moved = true;
      }
      return;
    }
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const r = this.pick(e.clientX, e.clientY);
    this.cb.onPointerMove(x, y, r);
    const id = r.kind === 'iceberg' || r.kind === 'route' ? (r.id ?? null) : r.kind === 'vessel' ? 'vessel' : null;
    if (id !== this.hoverId) {
      this.hoverId = id;
      this.renderer.domElement.style.cursor = id ? 'pointer' : '';
      this.cb.onHover(r, x, y);
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    const quick = performance.now() - this.pointer.t < 500;
    this.pointer.down = false;
    if (this.pointer.moved || !quick) return;
    const r = this.pick(e.clientX, e.clientY);
    this.cb.onPick(r);
  };

  private onPointerLeave = () => {
    this.pointer.down = false;
    this.hoverId = null;
    this.cb.onHover({ kind: 'none' }, 0, 0);
    this.cb.onPointerMove(-1, -1, { kind: 'none' });
  };

  // ── misc ────────────────────────────────────────────────────────────

  /** Radius of the rendered terrain disc, for the minimap. */
  get terrainRadiusKm() {
    return TERRAIN_RADIUS_KM;
  }

  get exaggeration() {
    return TERRAIN_EXAGGERATION;
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointerleave', this.onPointerLeave);
    this.controls.dispose();
    this.iceLayer.dispose();
    this.riskLayer.dispose();
    this.bergLayer.dispose();
    this.routeLayer.dispose();
    this.vesselLayer.dispose();
    this.zoneLayer.dispose();
    this.weatherLayer.dispose();
    this.overlayLayer.dispose();
    this.ocean.dispose();
    this.terrain.mesh.geometry.dispose();
    (this.terrain.mesh.material as THREE.Material).dispose();
    this.terrain.distanceTexture.dispose();
    this.iceTexture.dispose();
    this.backdrop.geometry.dispose();
    (this.backdrop.material as THREE.Material).dispose();
    this.renderer.dispose();
    if (el.parentElement) el.parentElement.removeChild(el);
  }
}
