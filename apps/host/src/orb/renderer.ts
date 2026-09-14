import {
  MAX_ORB_COLORS,
  normalizeOrbRecipe,
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
uniform float u_roughness;
uniform float u_warp;
uniform float u_cellularity;
uniform float u_anisotropy;
uniform float u_gloss;
uniform float u_glow;
uniform float u_rim;
uniform float u_grain_overlay;
uniform float u_drift;
uniform float u_turbulence;
uniform float u_pulse_amplitude;
uniform float u_pulse_period;
uniform float u_spin;
uniform float u_reactivity;

const float TAU = 6.28318530718;

float hash31(vec3 point) {
  point = fract(point * 0.1031);
  point += dot(point, point.yzx + 33.33 + u_seed.xyz * 7.1);
  return fract((point.x + point.y) * point.z);
}

vec3 hash33(vec3 point) {
  point = vec3(
    dot(point, vec3(127.1, 311.7, 74.7)),
    dot(point, vec3(269.5, 183.3, 246.1)),
    dot(point, vec3(113.5, 271.9, 124.6))
  );
  return fract(sin(point + u_seed.xyz * 19.7) * 43758.5453);
}

float value_noise(vec3 point) {
  vec3 cell = floor(point);
  vec3 local = fract(point);
  vec3 curve = local * local * (3.0 - 2.0 * local);

  float n000 = hash31(cell + vec3(0.0, 0.0, 0.0));
  float n100 = hash31(cell + vec3(1.0, 0.0, 0.0));
  float n010 = hash31(cell + vec3(0.0, 1.0, 0.0));
  float n110 = hash31(cell + vec3(1.0, 1.0, 0.0));
  float n001 = hash31(cell + vec3(0.0, 0.0, 1.0));
  float n101 = hash31(cell + vec3(1.0, 0.0, 1.0));
  float n011 = hash31(cell + vec3(0.0, 1.0, 1.0));
  float n111 = hash31(cell + vec3(1.0, 1.0, 1.0));

  return mix(
    mix(mix(n000, n100, curve.x), mix(n010, n110, curve.x), curve.y),
    mix(mix(n001, n101, curve.x), mix(n011, n111, curve.x), curve.y),
    curve.z
  );
}

float fbm(vec3 point) {
  float value = 0.0;
  float total = 0.0;
  float amplitude = 0.52;
  mat3 rotation = mat3(
    0.00, 0.80, 0.60,
    -0.80, 0.36, -0.48,
    -0.60, -0.48, 0.64
  );
  for (int octave = 0; octave < 5; octave++) {
    value += amplitude * value_noise(point);
    total += amplitude;
    point = rotation * point * 2.03 + vec3(7.7, 2.3, 5.1);
    amplitude *= mix(0.18, 0.52, u_roughness);
  }
  return value / total;
}

float cellular(vec3 point) {
  vec3 cell = floor(point);
  vec3 local = fract(point);
  float nearest = 10.0;
  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec3 neighbor = vec3(float(x), float(y), float(z));
        vec3 feature = hash33(cell + neighbor);
        feature = 0.5 + 0.5 * sin(TAU * feature + u_time * u_turbulence * 0.16);
        nearest = min(nearest, length(neighbor + feature - local));
      }
    }
  }
  return nearest;
}

vec3 palette_color(float position) {
  float total = 0.0;
  for (int index = 0; index < 6; index++) {
    if (index < u_color_count) total += max(u_weights[index], 0.0001);
  }

  float cursor = max(u_weights[0], 0.0001) / total;
  float softness = mix(0.24, 0.025, u_contrast);
  vec3 color = u_colors[0];
  for (int index = 1; index < 6; index++) {
    if (index < u_color_count) {
      color = mix(color, u_colors[index], smoothstep(cursor - softness, cursor + softness, position));
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

  float pulse_speed = mix(0.38, 1.35, u_pulse_period);
  float pulse = 1.0 + sin(u_time * pulse_speed + u_seed.w * TAU) * u_pulse_amplitude * 0.018;
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
  vec3 interior = normal + transmitted * sphere_z * mix(0.65, 1.35, u_gloss);
  float spin_angle = (u_seed.x - 0.5) * 1.8 + u_time * u_spin * 0.1;
  interior.xz = rotate_2d(spin_angle) * interior.xz;
  interior.xy = rotate_2d((u_seed.y - 0.5) * 2.4) * interior.xy;
  vec3 field_point = interior;
  field_point.xy *= vec2(
    mix(0.58, 1.72, u_anisotropy),
    mix(1.58, 0.72, u_anisotropy)
  );
  field_point *= mix(1.1, 4.8, u_grain);
  field_point += (u_seed.xyz - 0.5) * 13.0;

  float time = u_time * u_drift * 0.14;
  float deformation_time = u_time * u_turbulence * 0.12;
  vec3 flow = vec3(
    fbm(field_point + vec3(deformation_time, 0.0, -deformation_time * 0.4)),
    fbm(field_point + vec3(8.3, -deformation_time * 0.7, deformation_time * 0.5)),
    fbm(field_point + vec3(-5.1, deformation_time * 0.45, 4.7))
  ) - 0.5;
  field_point += flow * u_warp * 1.8;

  vec2 pointer_pull = (u_pointer - sphere_point) * u_reactivity * u_energy;
  field_point.xy += pointer_pull * 0.8;
  field_point.z += u_energy * u_turbulence * 0.4;

  float cloudy = fbm(field_point + vec3(0.0, 0.0, time));
  float back_cloud = fbm(field_point * 0.72 + transmitted * 1.6 + vec3(3.1, 0.0, time));
  float cells = cloudy;
  if (u_cellularity > 0.01) {
    cells = 1.0 - smoothstep(0.08, 0.82, cellular(field_point * 1.16));
  }
  float texture = mix(cloudy, cells, u_cellularity * 0.65);
  texture += sin((interior.x + interior.y * 0.7) * 3.0 + flow.z * 2.0) * u_anisotropy * 0.08;
  texture = clamp((texture - 0.5) * 2.25 + 0.5 + (u_seed.w - 0.5) * 0.12, 0.0, 1.0);

  vec3 color = palette_color(texture);
  vec3 depth_color = palette_color(clamp((back_cloud - 0.5) * 2.0 + 0.5, 0.0, 1.0));
  color = mix(color, depth_color, sphere_z * u_gloss * 0.24);

  // A darker inner edge and a bright Fresnel lip give the glass visible thickness.
  float facing = max(sphere_z, 0.0);
  float fresnel = pow(1.0 - facing, 3.0);
  float inner_edge = exp(-pow((facing - 0.3) / 0.17, 2.0));
  color *= 0.78 + 0.22 * facing - inner_edge * u_gloss * 0.18;
  color += color * pow(facing, 1.8) * u_glow * 0.22;
  vec3 edge_color = mix(depth_color, vec3(0.94, 0.97, 1.0), 0.72);
  color = mix(color, edge_color, fresnel * mix(0.18, 0.88, u_rim));

  // Fixed studio reflections stay coherent as the suspended color slowly moves.
  vec3 reflected = reflect(view_ray, normal);
  float key_light = max(dot(reflected, normalize(vec3(-0.55, 0.66, 0.72))), 0.0);
  float softbox = pow(key_light, mix(5.0, 18.0, u_gloss));
  float glint = pow(key_light, mix(28.0, 150.0, u_gloss));
  float fill_light = pow(max(dot(reflected, normalize(vec3(0.7, -0.65, 0.32))), 0.0), 14.0);
  color = mix(color, vec3(1.0, 0.98, 0.96), softbox * u_gloss * 0.3);
  color += vec3(1.0, 0.98, 0.96) * glint * u_gloss * 0.42;
  color += mix(depth_color, vec3(1.0), 0.55) * fill_light * u_gloss * 0.18;

  // Keep optional grain attached to the material instead of sparkling every frame.
  float pixel_grain = hash31(vec3(sphere_point * 240.0, u_seed.w)) - 0.5;
  color += pixel_grain * u_grain_overlay * 0.065;
  color = pow(max(color, 0.0), vec3(0.92));

  float edge_width = max(fwidth(distance_from_center) * 1.4, 0.002);
  float alpha = 1.0 - smoothstep(radius - edge_width, radius + edge_width, distance_from_center);
  out_color = vec4(color, alpha);
}`;

export type OrbMotionMode = "continuous" | "interaction" | "still";

export interface OrbRendererOptions {
  motion?: OrbMotionMode;
  reducedMotion?: boolean;
  onContextAvailabilityChange?: (available: boolean) => void;
}

const SCALAR_UNIFORMS = [
  ["u_contrast", 0],
  ["u_grain", 1],
  ["u_roughness", 2],
  ["u_warp", 3],
  ["u_cellularity", 4],
  ["u_anisotropy", 5],
  ["u_gloss", 6],
  ["u_glow", 7],
  ["u_rim", 8],
  ["u_grain_overlay", 9],
  ["u_drift", 10],
  ["u_turbulence", 11],
  ["u_pulse_amplitude", 12],
  ["u_pulse_period", 13],
  ["u_spin", 14],
  ["u_reactivity", 16],
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
      recipe.field.roughness,
      recipe.field.warp,
      recipe.field.cellularity,
      recipe.field.anisotropy,
      recipe.surface.gloss,
      recipe.surface.glow,
      recipe.surface.rim,
      recipe.surface.grainOverlay,
      recipe.motion.drift,
      recipe.motion.turbulence,
      recipe.motion.pulseAmplitude,
      recipe.motion.pulsePeriod,
      recipe.motion.spin,
      recipe.response.viscosity,
      recipe.response.reactivity,
      recipe.response.splash,
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

/** Owns one canvas and one WebGL program. Programs are never assumed to cross context boundaries. */
export class OrbRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private buffer: WebGLBuffer;
  private uniforms: Record<string, WebGLUniformLocation>;
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
  private frame: number | undefined;
  private startedAt = performance.now();
  private lastFrame = this.startedAt;
  private pointer = { x: 0, y: 0, vx: 0, vy: 0, targetX: 0, targetY: 0 };
  private energy = 0;
  private settle = 0.5;
  private resizeObserver: ResizeObserver;
  private intersectionObserver: IntersectionObserver | undefined;
  private readonly onContextAvailabilityChange?: (available: boolean) => void;

  constructor(
    canvas: HTMLCanvasElement,
    recipe: OrbVisualRecipe,
    options: OrbRendererOptions = {},
  ) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      depth: false,
      premultipliedAlpha: false,
      powerPreference: "low-power",
    });
    if (!gl) throw new Error("WebGL2 is unavailable");
    this.gl = gl;
    this.program = createProgram(gl);
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error("Could not create the Vibe orb geometry");
    this.buffer = buffer;
    this.uniforms = this.resolveUniforms();
    this.current = flattenRecipe(recipe);
    this.transitionFrom = this.current;
    this.target = this.current;
    this.motion = options.motion ?? "continuous";
    this.reducedMotion = options.reducedMotion ?? false;
    this.onContextAvailabilityChange = options.onContextAvailabilityChange;
    this.settle = normalizeOrbRecipe(recipe).response.settle;

    this.initializeGeometry();
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
    this.onContextAvailabilityChange?.(true);
    this.updateSchedule();
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
      "u_contrast",
      "u_grain",
      "u_roughness",
      "u_warp",
      "u_cellularity",
      "u_anisotropy",
      "u_gloss",
      "u_glow",
      "u_rim",
      "u_grain_overlay",
      "u_drift",
      "u_turbulence",
      "u_pulse_amplitude",
      "u_pulse_period",
      "u_spin",
      "u_reactivity",
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

  setRecipe(recipe: OrbVisualRecipe, transitionMs = 900) {
    const now = performance.now();
    this.current = this.sampleRecipe(now);
    this.transitionFrom = this.current;
    this.target = flattenRecipe(recipe);
    this.transitionStarted = now;
    this.transitionDuration = this.reducedMotion ? 0 : Math.max(0, transitionMs);
    this.settle = normalizeOrbRecipe(recipe).response.settle;
    this.updateSchedule();
  }

  setMotion(motion: OrbMotionMode) {
    this.motion = motion;
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
    const eased = 1 - Math.pow(1 - progress, 3);
    return mixRecipe(this.transitionFrom, this.target, eased);
  }

  private readonly handleResize = () => {
    const bounds = this.canvas.getBoundingClientRect();
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(bounds.width * pixelRatio));
    const height = Math.max(1, Math.round(bounds.height * pixelRatio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.render(performance.now());
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
    const splash = this.target.scalars[17] ?? 0;
    this.energy = Math.min(1, this.energy + 0.3 + splash * 0.7);
    this.updateSchedule();
  };

  private readonly handleContextLost = (event: Event) => {
    event.preventDefault();
    this.contextLost = true;
    this.canvas.dataset.vibeOrbAnimating = "false";
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.onContextAvailabilityChange?.(false);
  };

  private readonly handleContextRestored = () => {
    try {
      this.program = createProgram(this.gl);
      const buffer = this.gl.createBuffer();
      if (!buffer) throw new Error("Could not restore the Vibe orb geometry");
      this.buffer = buffer;
      this.uniforms = this.resolveUniforms();
      this.initializeGeometry();
      this.contextLost = false;
      this.onContextAvailabilityChange?.(true);
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

  private updateSchedule() {
    if (this.contextLost) return;
    const now = performance.now();
    this.render(now);
    const animate = this.shouldAnimate(now);
    this.canvas.dataset.vibeOrbAnimating = String(animate);
    if (animate && this.frame === undefined) {
      this.lastFrame = now;
      this.frame = requestAnimationFrame(this.tick);
    } else if (!this.shouldAnimate(now) && this.frame !== undefined) {
      cancelAnimationFrame(this.frame);
      this.frame = undefined;
    }
  }

  private readonly tick = (now: number) => {
    this.frame = undefined;
    const delta = Math.min(0.05, Math.max(0.001, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    const viscosity = this.target.scalars[15] ?? 0.5;
    const stiffness = 18 - viscosity * 10;
    const damping = 3.2 + viscosity * 7;
    this.pointer.vx += (this.pointer.targetX - this.pointer.x) * stiffness * delta;
    this.pointer.vy += (this.pointer.targetY - this.pointer.y) * stiffness * delta;
    this.pointer.vx *= Math.exp(-damping * delta);
    this.pointer.vy *= Math.exp(-damping * delta);
    this.pointer.x += this.pointer.vx * delta;
    this.pointer.y += this.pointer.vy * delta;
    const hoverFloor = this.interacting ? 0.14 : 0;
    const decay = Math.exp(-delta * (1.4 + (1 - this.settle) * 5.6));
    this.energy = hoverFloor + (this.energy - hoverFloor) * decay;
    this.render(now);
    if (this.shouldAnimate(now)) this.frame = requestAnimationFrame(this.tick);
    else this.canvas.dataset.vibeOrbAnimating = "false";
  };

  private render(now: number) {
    if (this.contextLost || !this.canvas.width || !this.canvas.height) return;
    this.current = this.sampleRecipe(now);
    const recipe = this.current;
    const gl = this.gl;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniform2f(this.uniforms.u_resolution!, this.canvas.width, this.canvas.height);
    const elapsed = this.reducedMotion ? 0 : (now - this.startedAt) / 1000;
    gl.uniform1f(this.uniforms.u_time!, elapsed);
    gl.uniform4fv(this.uniforms.u_seed!, recipe.seed);
    gl.uniform2f(this.uniforms.u_pointer!, this.pointer.x, this.pointer.y);
    gl.uniform1f(this.uniforms.u_energy!, this.energy);
    gl.uniform3fv(this.uniforms["u_colors[0]"]!, recipe.colors);
    gl.uniform1fv(this.uniforms["u_weights[0]"]!, recipe.weights);
    gl.uniform1i(this.uniforms.u_color_count!, recipe.colorCount);
    SCALAR_UNIFORMS.forEach(([name, index]) => {
      const uniform = this.uniforms[name];
      if (uniform) gl.uniform1f(uniform, recipe.scalars[index] ?? 0);
    });
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  destroy() {
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
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteProgram(this.program);
  }
}

export const ORB_SHADER_SOURCE = { vertex: VERTEX_SHADER, fragment: FRAGMENT_SHADER } as const;
