/**
 * Module: Compiles and links GLSL shaders with clear errors so renderer startup fails loudly when shader code is invalid.
 */
function compileShader(gl, type, source, label) {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error(`[SectorRenderer] ${label} shader allocation failed.`);
  }

  try {
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? 'unknown shader compile error';
      throw new Error(`[SectorRenderer] ${label} shader compilation failed: ${log}`);
    }

    return shader;
  } catch (error) {
    gl.deleteShader(shader);
    throw error;
  }
}

/** Compiles and links a vertex/fragment shader pair into a usable program. */
export function createShaderProgram(gl, { vertexSource, fragmentSource }) {
  let vertexShader = null;
  let fragmentShader = null;
  let program = null;

  try {
    vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource, 'Vertex');
    fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource, 'Fragment');

    program = gl.createProgram();
    if (!program) {
      throw new Error('[SectorRenderer] Shader program allocation failed.');
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? 'unknown program link error';
      throw new Error(`[SectorRenderer] Shader program link failed: ${log}`);
    }

    return program;
  } catch (error) {
    if (program) gl.deleteProgram(program);
    throw error;
  } finally {
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
  }
}
