import {
  MAX_ORB_COLORS,
  ORB_MATERIAL,
  normalizeOrbRecipe,
  orbMotionForCharacter,
  orbSeedVector,
  type OrbVisualRecipe,
} from "./recipe.ts";

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 out_color;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec4 u_seed;
uniform vec2 u_pointer;
uniform float u_energy;
uniform vec3 u_colors[6];
uniform float u_weights[6];
uniform int u_color_count;
uniform float u_contrast;
uniform float u_grain;
uniform float u_warp;
uniform float u_anisotropy;
uniform float u_drift;
uniform float u_turbulence;
uniform float u_spin;
uniform float u_depth;
uniform float u_glow;

const float GLASS_GLOSS = ${ORB_MATERIAL.surface.gloss};
const float GLASS_GRAIN = ${ORB_MATERIAL.surface.grainOverlay};
const float PULSE_AMPLITUDE = ${ORB_MATERIAL.motion.pulseAmplitude};
const float PULSE_PERIOD = ${ORB_MATERIAL.motion.pulsePeriod};
const float REACTIVITY = ${ORB_MATERIAL.response.reactivity};

const float TAU = 6.28318530718;

float hash31(vec3 point) {
  point = fract(point * 0.1031);
  point += dot(point, point.yzx + 33.33 + u_seed.xyz * 7.1);
  return fract((point.x + point.y) * point.z);
}

vec3 rgb_hsv(vec3 c) {
  vec4 k = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, k.wz), vec4(c.gb, k.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1.0e-10)), d / (q.x + 1.0e-10), q.x);
}

vec3 hsv_rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

vec3 color_blend(vec3 a, vec3 b, float t) {
  vec3 ah = rgb_hsv(a), bh = rgb_hsv(b);
  float arc = fract(bh.x - ah.x + 0.5) - 0.5;
  return hsv_rgb(vec3(ah.x + arc * t, mix(ah.yz, bh.yz, t)));
}

vec3 palette_color(float position) {
  float total = 0.0;
  for (int index = 0; index < 6; index++) {
    if (index < u_color_count) total += max(u_weights[index], 0.0001);
  }

  float cursor = max(u_weights[0], 0.0001) / total;
  float softness = mix(0.3, 0.085, u_contrast);
  vec3 color = u_colors[0];
  for (int index = 1; index < 6; index++) {
    if (index < u_color_count) {
      color = color_blend(color, u_colors[index], smoothstep(cursor - softness, cursor + softness, position));
      cursor += max(u_weights[index], 0.0001) / total;
    }
  }
  return color;
}

mat2 rotate_2d(float angle) {
  float sine = sin(angle);
  float cosine = cos(angle);
  return mat2(cosine, -sine, sine, cosine);
}

void main() {
  vec2 point = (v_uv - 0.5) * 2.0;
  point.x *= u_resolution.x / max(u_resolution.y, 1.0);

  float pulse_speed = mix(0.38, 1.35, PULSE_PERIOD);
  float pulse = 1.0 + sin(u_time * pulse_speed + u_seed.w * TAU) * PULSE_AMPLITUDE * 0.018;
  float radius = 0.91 * pulse;
  float distance_from_center = length(point);
  if (distance_from_center > radius + 0.02) {
    out_color = vec4(0.0);
    return;
  }
  vec2 sphere_point = point / radius;
  float sphere_z = sqrt(max(0.0, 1.0 - dot(sphere_point, sphere_point)));
  vec3 normal = normalize(vec3(sphere_point, sphere_z));

  // Bend the view into the sphere; the color lives below a smooth, stationary shell.
  vec3 view_ray = vec3(0.0, 0.0, -1.0);
  vec3 transmitted = refract(view_ray, normal, 1.0 / 1.46);
  vec3 interior = normal + transmitted * sphere_z * mix(0.35, 1.5, u_depth);
  float spin_angle = u_time * u_spin * 0.28;
  interior.xz = rotate_2d(spin_angle) * interior.xz;
  interior.xy = rotate_2d(u_seed.y * TAU) * interior.xy;

  // Broad analytic pools and ribbons avoid the high-frequency noise of a planet surface.
  vec2 field_point = interior.xy * mix(1.2, 3.2, u_grain);
  float time = u_time * u_drift * 0.35;
  float deformation = u_time * u_turbulence * 0.3;
  float phase = u_seed.x * TAU;
  float twist = (1.0 - dot(interior.xy, interior.xy)) * u_warp * 2.8;
  field_point = rotate_2d(twist) * field_point;
  field_point += vec2(
    sin(field_point.y * 1.2 + phase + deformation),
    cos(field_point.x * 1.1 - phase - deformation * 0.7)
  ) * u_warp * 0.65;
  field_point += (u_pointer - sphere_point) * REACTIVITY * u_energy * 0.7;

  float pools = 0.5 + sin(field_point.x * 1.45 + time + phase) * 0.29
    + cos(field_point.y * 1.35 - time * 0.6 + u_seed.z * TAU) * 0.22;
  float ribbons = 0.5 + sin(field_point.y * 2.2 + sin(field_point.x + deformation) * u_warp * 1.8 + phase + time) * 0.47;
  float texture = clamp(mix(pools, ribbons, u_anisotropy), 0.0, 1.0);
  vec3 color = palette_color(texture);
  vec3 depth_color = palette_color(clamp(texture + sin(interior.z * 2.0 + phase) * 0.16, 0.0, 1.0));
  color = color_blend(color, depth_color, sphere_z * u_depth * 0.16);

  // A darker inner edge and a bright Fresnel lip give the glass visible thickness.
  float facing = max(sphere_z, 0.0);
  float fresnel = pow(1.0 - facing, 3.0);
  float inner_edge = exp(-pow((facing - 0.3) / 0.17, 2.0));
  color *= 0.78 + 0.22 * facing - inner_edge * u_depth * 0.16;
  color += color * pow(facing, 1.8) * u_glow * 0.3;
  vec3 edge_color = mix(depth_color, vec3(0.94, 0.97, 1.0), 0.38);
  color = mix(color, edge_color, fresnel * mix(0.3, 0.8, u_depth));

  // Fixed studio reflections stay coherent as the suspended color slowly moves.
  vec3 reflected = reflect(view_ray, normal);
  float key_light = max(dot(reflected, normalize(vec3(-0.55, 0.66, 0.72))), 0.0);
  float softbox = pow(key_light, mix(5.0, 18.0, GLASS_GLOSS));
  float glint = pow(key_light, mix(28.0, 150.0, GLASS_GLOSS));
  float fill_light = pow(max(dot(reflected, normalize(vec3(0.7, -0.65, 0.32))), 0.0), 14.0);
  color = mix(color, vec3(1.0, 0.98, 0.96), softbox * GLASS_GLOSS * 0.3);
  color += vec3(1.0, 0.98, 0.96) * glint * GLASS_GLOSS * 0.42;
  color += mix(depth_color, vec3(1.0), 0.55) * fill_light * GLASS_GLOSS * 0.18;

  // Keep optional grain attached to the material instead of sparkling every frame.
  float pixel_grain = hash31(vec3(sphere_point * 240.0, u_seed.w)) - 0.5;
  color += pixel_grain * GLASS_GRAIN * 0.065;
  color = pow(max(color, 0.0), vec3(0.92));

  float edge_width = max(fwidth(distance_from_center) * 1.4, 0.002);
  float alpha = 1.0 - smoothstep(radius - edge_width, radius + edge_width, distance_from_center);
  out_color = vec4(color, alpha);
}`;

export type OrbMotionMode = "continuous" | "interaction" | "still";

export interface OrbRendererOptions {
  motion?: OrbMotionMode;
  reducedMotion?: boolean;
  maxFps?: number;
  maxPixelRatio?: number;
  onContextAvailabilityChange?: (available: boolean) => void;
}

const SCALAR_UNIFORMS = [
  ["u_contrast", 0],
  ["u_grain", 1],
  ["u_warp", 2],
  ["u_anisotropy", 3],
  ["u_drift", 4],
  ["u_turbulence", 5],
  ["u_spin", 6],
  ["u_depth", 7],
  ["u_glow", 8],
] as const;

interface FlatRecipe {
  colors: Float32Array;
  weights: Float32Array;
  colorCount: number;
  seed: readonly [number, number, number, number];
  scalars: Float32Array;
}

function rgb(hex: string): readonly [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16) / 255,
    Number.parseInt(hex.slice(3, 5), 16) / 255,
    Number.parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

function flattenRecipe(input: OrbVisualRecipe): FlatRecipe {
  const recipe = normalizeOrbRecipe(input);
  const motion = orbMotionForCharacter(recipe.motion);
  const colors = new Float32Array(MAX_ORB_COLORS * 3);
  const weights = new Float32Array(MAX_ORB_COLORS);
  recipe.palette.forEach(({ color, weight }, index) => {
    colors.set(rgb(color), index * 3);
    weights[index] = weight;
  });
  for (let index = recipe.palette.length; index < MAX_ORB_COLORS; index += 1) {
    colors.set(rgb(recipe.palette.at(-1)!.color), index * 3);
  }

  return {
    colors,
    weights,
    colorCount: recipe.palette.length,
    seed: orbSeedVector(recipe.seed),
    scalars: new Float32Array([
      recipe.contrast,
      recipe.field.grain,
      recipe.field.warp,
      recipe.field.anisotropy,
      motion.drift,
      motion.turbulence,
      motion.spin,
      recipe.surface.depth,
      recipe.surface.glow,
    ]),
  };
}

function mixArray(from: Float32Array, to: Float32Array, amount: number): Float32Array {
  const result = new Float32Array(from.length);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = (from[index] ?? 0) + ((to[index] ?? 0) - (from[index] ?? 0)) * amount;
  }
  return result;
}

function mixRecipe(from: FlatRecipe, to: FlatRecipe, amount: number): FlatRecipe {
  return {
    colors: mixArray(from.colors, to.colors, amount),
    weights: mixArray(from.weights, to.weights, amount),
    colorCount: amount < 0.5 ? from.colorCount : to.colorCount,
    seed: from.seed.map((value, index) => value + (to.seed[index]! - value) * amount) as [
      number,
      number,
      number,
      number,
    ],
    scalars: mixArray(from.scalars, to.scalars, amount),
  };
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Could not create the Vibe orb shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Unknown shader compile error";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) throw new Error("Could not create the Vibe orb program");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? "Unknown shader link error";
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

function location(gl: WebGL2RenderingContext, program: WebGLProgram, name: string) {
  const value = gl.getUniformLocation(program, name);
  if (value === null) throw new Error(`Missing Vibe orb uniform ${name}`);
  return value;
}

const contextReleaseTimers = new WeakMap<HTMLCanvasElement, ReturnType<typeof setTimeout>>();

/** Shared draw path for live animation and detached thumbnail rendering. */
class OrbPainter {
  readonly gl: WebGL2RenderingContext;
  private program!: WebGLProgram;
  private buffer!: WebGLBuffer;
  private uniforms!: Record<string, WebGLUniformLocation>;
  private lastRecipe: FlatRecipe | undefined;

  constructor(readonly canvas: HTMLCanvasElement) {
    clearTimeout(contextReleaseTimers.get(canvas));
    contextReleaseTimers.delete(canvas);
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      depth: false,
      premultipliedAlpha: false,
      powerPreference: "low-power",
    });
    if (!gl) throw new Error("WebGL2 is unavailable");
    this.gl = gl;
    try {
      this.program = createProgram(gl);
      const buffer = gl.createBuffer();
      if (!buffer) throw new Error("Could not create the Vibe orb geometry");
      this.buffer = buffer;
      this.uniforms = this.resolveUniforms();
      this.initializeGeometry();
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  private resolveUniforms(): Record<string, WebGLUniformLocation> {
    const names = [
      "u_resolution",
      "u_time",
      "u_seed",
      "u_pointer",
      "u_energy",
      "u_colors[0]",
      "u_weights[0]",
      "u_color_count",
      ...SCALAR_UNIFORMS.map(([name]) => name),
    ] as const;
    return Object.fromEntries(names.map((name) => [name, location(this.gl, this.program, name)]));
  }

  private initializeGeometry() {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(this.program, "a_position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
  }

  draw(recipe: FlatRecipe, time: number, pointerX = 0, pointerY = 0, energy = 0) {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniform2f(this.uniforms.u_resolution!, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uniforms.u_time!, time);
    gl.uniform2f(this.uniforms.u_pointer!, pointerX, pointerY);
    gl.uniform1f(this.uniforms.u_energy!, energy);
    if (this.lastRecipe !== recipe) {
      gl.uniform4fv(this.uniforms.u_seed!, recipe.seed);
      gl.uniform3fv(this.uniforms["u_colors[0]"]!, recipe.colors);
      gl.uniform1fv(this.uniforms["u_weights[0]"]!, recipe.weights);
      gl.uniform1i(this.uniforms.u_color_count!, recipe.colorCount);
      SCALAR_UNIFORMS.forEach(([name, index]) => {
        const uniform = this.uniforms[name];
        if (uniform) gl.uniform1f(uniform, recipe.scalars[index] ?? 0);
      });
      this.lastRecipe = recipe;
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  destroy() {
    if (this.buffer) this.gl.deleteBuffer(this.buffer);
    if (this.program) this.gl.deleteProgram(this.program);
    // React StrictMode may immediately set up this same canvas again. Release an abandoned
    // context on the next task, while allowing that synchronous setup to cancel the release.
    clearTimeout(contextReleaseTimers.get(this.canvas));
    contextReleaseTimers.set(
      this.canvas,
      setTimeout(() => {
        contextReleaseTimers.delete(this.canvas);
        this.gl.getExtension("WEBGL_lose_context")?.loseContext();
      }, 0),
    );
  }
}

// Retain at most two detached icon canvases and their compiled programs. These have no renderer,
// animation loop, observers, or React tree while idle, and are released after a short idle period.
const idlePainters: { painter: OrbPainter; timer: ReturnType<typeof setTimeout> }[] = [];

function takeIdlePainter(): OrbPainter | undefined {
  while (idlePainters.length) {
    const entry = idlePainters.pop()!;
    clearTimeout(entry.timer);
    if (!entry.painter.gl.isContextLost()) return entry.painter;
    entry.painter.destroy();
  }
}

function recyclePainter(painter: OrbPainter) {
  const entry = {
    painter,
    timer: setTimeout(() => {
      const index = idlePainters.indexOf(entry);
      if (index !== -1) idlePainters.splice(index, 1);
      painter.destroy();
    }, 30_000),
  };
  idlePainters.push(entry);
  if (idlePainters.length > 2) {
    const oldest = idlePainters.shift()!;
    clearTimeout(oldest.timer);
    oldest.painter.destroy();
  }
}

function clearIdlePainters() {
  for (const entry of idlePainters.splice(0)) {
    clearTimeout(entry.timer);
    entry.painter.destroy();
  }
}

if (typeof window !== "undefined") window.addEventListener("pagehide", clearIdlePainters);
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    window.removeEventListener("pagehide", clearIdlePainters);
    clearIdlePainters();
  });
}

/** No DOM observers, input listeners, or animation loop. Callers serialize captures. */
export class OrbRasterizer {
  private readonly canvas = document.createElement("canvas");
  private readonly painter = new OrbPainter(this.canvas);

  render(recipe: OrbVisualRecipe, size: number): Promise<Blob> {
    this.canvas.width = size;
    this.canvas.height = size;
    if (this.painter.gl.isContextLost()) throw new Error("Orb rendering context was lost");
    this.painter.draw(flattenRecipe(recipe), 0);
    // Snapshot in the same task as draw(), before the browser discards its drawing buffer.
    return new Promise((resolve, reject) => {
      this.canvas.toBlob((blob) => {
        if (blob && !this.painter.gl.isContextLost()) resolve(blob);
        else reject(new Error("Could not capture the Vibe orb"));
      }, "image/png");
    });
  }

  destroy() {
    this.painter.destroy();
  }
}

/** Owns one canvas and one WebGL program. Programs are never assumed to cross context boundaries. */
export class OrbRenderer {
  readonly canvas: HTMLCanvasElement;
  private painter: OrbPainter;
  private current: FlatRecipe;
  private transitionFrom: FlatRecipe;
  private target: FlatRecipe;
  private transitionStarted = 0;
  private transitionDuration = 0;
  private motion: OrbMotionMode;
  private reducedMotion: boolean;
  private visible = true;
  private interacting = false;
  private contextLost = false;
  private destroyed = false;
  private ready = false;
  private frame: number | undefined;
  private startedAt = performance.now();
  private lastFrame = this.startedAt;
  private lastDraw = Number.NEGATIVE_INFINITY;
  private readonly frameInterval: number;
  private readonly maxPixelRatio: number;
  private recipeKey: string;
  private pointer = { x: 0, y: 0, vx: 0, vy: 0, targetX: 0, targetY: 0 };
  private energy = 0;
  private resizeObserver: ResizeObserver;
  private intersectionObserver: IntersectionObserver | undefined;
  private readonly onContextAvailabilityChange?: (available: boolean) => void;

  constructor(
    canvas: HTMLCanvasElement,
    recipe: OrbVisualRecipe,
    options: OrbRendererOptions = {},
    painter?: OrbPainter,
  ) {
    this.canvas = canvas;
    this.painter = painter ?? new OrbPainter(canvas);
    this.recipeKey = JSON.stringify(normalizeOrbRecipe(recipe));
    this.current = flattenRecipe(recipe);
    this.transitionFrom = this.current;
    this.target = this.current;
    this.motion = options.motion ?? "continuous";
    this.reducedMotion = options.reducedMotion ?? false;
    this.frameInterval = 1000 / Math.max(1, options.maxFps ?? 60);
    this.maxPixelRatio = Math.max(1, options.maxPixelRatio ?? 2);
    this.onContextAvailabilityChange = options.onContextAvailabilityChange;

    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.resizeObserver.observe(canvas);
    if (typeof IntersectionObserver !== "undefined") {
      this.intersectionObserver = new IntersectionObserver(([entry]) => {
        this.visible = entry?.isIntersecting ?? true;
        this.updateSchedule();
      });
      this.intersectionObserver.observe(canvas);
    }

    canvas.addEventListener("pointerenter", this.handlePointerEnter);
    canvas.addEventListener("pointermove", this.handlePointerMove);
    canvas.addEventListener("pointerleave", this.handlePointerLeave);
    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("webglcontextlost", this.handleContextLost);
    canvas.addEventListener("webglcontextrestored", this.handleContextRestored);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    this.handleResize();
    this.updateSchedule();
  }

  /** Acquire reusable graphics resources, with fresh interaction state for the new icon. */
  static forIcon(recipe: OrbVisualRecipe, options: OrbRendererOptions = {}): OrbRenderer {
    const painter = takeIdlePainter();
    const canvas = painter?.canvas ?? document.createElement("canvas");
    return new OrbRenderer(canvas, recipe, { ...options, maxFps: 30, maxPixelRatio: 1.5 }, painter);
  }

  /** Refresh after an imperative mount or moving a recycled canvas into its new container. */
  resize() {
    this.handleResize();
  }

  setRecipe(recipe: OrbVisualRecipe, transitionMs = 900) {
    const key = JSON.stringify(normalizeOrbRecipe(recipe));
    if (key === this.recipeKey) return;
    this.recipeKey = key;
    const now = performance.now();
    this.current = this.sampleRecipe(now);
    this.transitionFrom = this.current;
    this.target = flattenRecipe(recipe);
    this.transitionStarted = now;
    this.transitionDuration =
      this.reducedMotion || this.motion === "still" ? 0 : Math.max(0, transitionMs);
    this.updateSchedule();
  }

  setMotion(motion: OrbMotionMode) {
    this.motion = motion;
    if (motion === "still") this.transitionDuration = 0;
    this.updateSchedule();
  }

  setReducedMotion(reducedMotion: boolean) {
    this.reducedMotion = reducedMotion;
    if (reducedMotion) {
      this.transitionDuration = 0;
      this.energy = 0;
      this.pointer = { x: 0, y: 0, vx: 0, vy: 0, targetX: 0, targetY: 0 };
    }
    this.updateSchedule();
  }

  /** Lets an accessible parent button drive hover/focus motion without making the canvas focusable. */
  setInteraction(active: boolean) {
    this.interacting = active;
    if (active) this.energy = Math.max(this.energy, 0.14);
    else {
      this.pointer.targetX = 0;
      this.pointer.targetY = 0;
    }
    this.updateSchedule();
  }

  private sampleRecipe(now: number): FlatRecipe {
    if (this.transitionDuration === 0) return this.target;
    const progress = Math.min(1, (now - this.transitionStarted) / this.transitionDuration);
    if (progress >= 1) {
      this.transitionDuration = 0;
      this.transitionFrom = this.target;
      return this.target;
    }
    const eased = 1 - Math.pow(1 - progress, 3);
    return mixRecipe(this.transitionFrom, this.target, eased);
  }

  private readonly handleResize = (entries?: ResizeObserverEntry[]) => {
    // A borrowed canvas has no layout until it is attached. Keep its existing drawing buffer
    // instead of reallocating it to 1×1 and immediately back to icon size on every hover.
    if (this.destroyed || !this.canvas.isConnected) return;
    // Dock opening scales an ancestor. Its screen-space rect can be only a few pixels wide,
    // and transforms don't trigger a later layout resize. Size the buffer from the content box.
    const bounds = entries?.[0]?.contentRect;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    const width = Math.max(1, Math.round((bounds?.width ?? this.canvas.clientWidth) * pixelRatio));
    const height = Math.max(
      1,
      Math.round((bounds?.height ?? this.canvas.clientHeight) * pixelRatio),
    );
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.updateSchedule();
  };

  private readonly handlePointerEnter = () => {
    this.interacting = true;
    this.energy = Math.max(this.energy, 0.12);
    this.updateSchedule();
  };

  private readonly handlePointerMove = (event: PointerEvent) => {
    const bounds = this.canvas.getBoundingClientRect();
    this.pointer.targetX = ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * 2 - 1;
    this.pointer.targetY = (1 - (event.clientY - bounds.top) / Math.max(bounds.height, 1)) * 2 - 1;
    this.energy = Math.max(this.energy, 0.18);
    this.updateSchedule();
  };

  private readonly handlePointerLeave = () => {
    this.interacting = false;
    this.pointer.targetX = 0;
    this.pointer.targetY = 0;
    this.updateSchedule();
  };

  private readonly handlePointerDown = () => {
    const splash = ORB_MATERIAL.response.splash;
    this.energy = Math.min(1, this.energy + 0.3 + splash * 0.7);
    this.updateSchedule();
  };

  private readonly handleContextLost = (event: Event) => {
    event.preventDefault();
    this.contextLost = true;
    this.ready = false;
    this.canvas.dataset.vibeOrbAnimating = "false";
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.onContextAvailabilityChange?.(false);
  };

  private readonly handleContextRestored = () => {
    try {
      this.painter = new OrbPainter(this.canvas);
      this.contextLost = false;
      this.handleResize();
      this.updateSchedule();
    } catch {
      this.onContextAvailabilityChange?.(false);
    }
  };

  private readonly handleVisibilityChange = () => this.updateSchedule();

  private shouldAnimate(now: number): boolean {
    if (this.reducedMotion || this.motion === "still" || !this.visible || document.hidden)
      return false;
    const transitioning = now - this.transitionStarted < this.transitionDuration;
    return (
      this.motion === "continuous" ||
      this.interacting ||
      transitioning ||
      this.energy > 0.002 ||
      Math.abs(this.pointer.x) + Math.abs(this.pointer.y) > 0.002
    );
  }

  private canRender(): boolean {
    return (
      !this.destroyed &&
      !this.contextLost &&
      this.canvas.isConnected &&
      this.visible &&
      !document.hidden
    );
  }

  private updateSchedule() {
    const now = performance.now();
    const animate = this.canRender() && this.shouldAnimate(now);
    this.canvas.dataset.vibeOrbAnimating = String(animate);
    if (this.canRender() && this.frame === undefined) {
      this.lastFrame = now;
      this.frame = requestAnimationFrame(this.tick);
    } else if (!this.canRender() && this.frame !== undefined) {
      cancelAnimationFrame(this.frame);
      this.frame = undefined;
    }
  }

  private readonly tick = (now: number) => {
    this.frame = undefined;
    if (!this.canRender()) {
      this.canvas.dataset.vibeOrbAnimating = "false";
      return;
    }
    // Event bursts only invalidate the next frame. Small icons also skip excess display frames.
    if (now - this.lastDraw < this.frameInterval - 0.5) {
      this.frame = requestAnimationFrame(this.tick);
      return;
    }
    const elapsed = Math.max(0, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const viscosity = ORB_MATERIAL.response.viscosity;
    const stiffness = 18 - viscosity * 10;
    const damping = 3.2 + viscosity * 7;
    // Catch up slow frames in stable spring steps, with bounded work after a long pause.
    const springElapsed = Math.min(1, elapsed);
    const steps = Math.max(1, Math.ceil(springElapsed / 0.05));
    const delta = springElapsed / steps;
    for (let step = 0; step < steps; step++) {
      this.pointer.vx += (this.pointer.targetX - this.pointer.x) * stiffness * delta;
      this.pointer.vy += (this.pointer.targetY - this.pointer.y) * stiffness * delta;
      this.pointer.vx *= Math.exp(-damping * delta);
      this.pointer.vy *= Math.exp(-damping * delta);
      this.pointer.x += this.pointer.vx * delta;
      this.pointer.y += this.pointer.vy * delta;
    }
    const hoverFloor = this.interacting ? 0.14 : 0;
    // Analytic decay needs real elapsed time; a spring delta cap prolongs motion below 20 FPS.
    const decay = Math.exp(-elapsed * (1.4 + (1 - ORB_MATERIAL.response.settle) * 5.6));
    this.energy = hoverFloor + (this.energy - hoverFloor) * decay;
    this.render(now);
    this.lastDraw = now;
    if (this.shouldAnimate(now)) this.frame = requestAnimationFrame(this.tick);
    else this.canvas.dataset.vibeOrbAnimating = "false";
  };

  private render(now: number) {
    if (this.contextLost || !this.canvas.width || !this.canvas.height) return;
    this.current = this.sampleRecipe(now);
    const frozen = this.reducedMotion || this.motion === "still";
    this.painter.draw(
      this.current,
      frozen ? 0 : (now - this.startedAt) / 1000,
      frozen ? 0 : this.pointer.x,
      frozen ? 0 : this.pointer.y,
      frozen ? 0 : this.energy,
    );
    if (!this.ready) {
      this.ready = true;
      this.onContextAvailabilityChange?.(true);
    }
  }

  destroy({ recycle = false }: { recycle?: boolean } = {}) {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.canvas.dataset.vibeOrbAnimating = "false";
    this.resizeObserver.disconnect();
    this.intersectionObserver?.disconnect();
    this.canvas.removeEventListener("pointerenter", this.handlePointerEnter);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerleave", this.handlePointerLeave);
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.handleContextRestored);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    if (recycle && !this.contextLost && !this.painter.gl.isContextLost()) {
      recyclePainter(this.painter);
    } else {
      this.painter.destroy();
    }
  }
}

export const ORB_SHADER_SOURCE = { vertex: VERTEX_SHADER, fragment: FRAGMENT_SHADER } as const;
