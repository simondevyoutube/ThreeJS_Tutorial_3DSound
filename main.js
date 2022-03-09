import * as THREE from 'https://cdn.skypack.dev/three@0.136';

import {EffectComposer} from 'https://cdn.skypack.dev/three@0.136/examples/jsm/postprocessing/EffectComposer.js';
import {ShaderPass} from 'https://cdn.skypack.dev/three@0.136/examples//jsm/postprocessing/ShaderPass.js';
import {GammaCorrectionShader} from 'https://cdn.skypack.dev/three@0.136/examples/jsm/shaders/GammaCorrectionShader.js';
import {RenderPass} from 'https://cdn.skypack.dev/three@0.136/examples/jsm/postprocessing/RenderPass.js';
import {FXAAShader} from 'https://cdn.skypack.dev/three@0.136/examples/jsm/shaders/FXAAShader.js';

import {math} from './math.js';
import {noise} from './noise.js';



const FS_DECLARATIONS = `

uniform sampler2D audioDataTexture;
uniform vec2 iResolution;
uniform float iTime;

#define M_PI 3.14159
#define NUM_BARS 64.0
#define CIRCLE_RADIUS 0.15
#define BAR_HEIGHT 0.125


// All code snippets taken from Inigo Quilez's site
// Make sure to check out his site!
// https://iquilezles.org/
//
vec3 pal( in float t, in vec3 a, in vec3 b, in vec3 c, in vec3 d) {
    return a + b*cos( 6.28318*(c*t+d) );
}

float dot2(in vec2 v ) { return dot(v,v); }

float sdfTrapezoid(in vec2 p, in float r1, float r2, float he) {
  vec2 k1 = vec2(r2,he);
  vec2 k2 = vec2(r2-r1,2.0*he);
  p.x = abs(p.x);
  vec2 ca = vec2(p.x-min(p.x,(p.y<0.0)?r1:r2), abs(p.y)-he);
  vec2 cb = p - k1 + k2*clamp( dot(k1-p,k2)/dot2(k2), 0.0, 1.0 );
  float s = (cb.x<0.0 && ca.y<0.0) ? -1.0 : 1.0;
  return s*sqrt( min(dot2(ca),dot2(cb)) );
}

float sdUnevenCapsule( vec2 p, float r1, float r2, float h ) {
    p.x = abs(p.x);
    float b = (r1-r2)/h;
    float a = sqrt(1.0-b*b);
    float k = dot(p,vec2(-b,a));
    if( k < 0.0 ) return length(p) - r1;
    if( k > a*h ) return length(p-vec2(0.0,h)) - r2;
    return dot(p, vec2(a,b) ) - r1;
}

float sdTriangleIsosceles( in vec2 p, in vec2 q ) {
    p.x = abs(p.x);
    vec2 a = p - q*clamp( dot(p,q)/dot(q,q), 0.0, 1.0 );
    vec2 b = p - q*vec2( clamp( p.x/q.x, 0.0, 1.0 ), 1.0 );
    float s = -sign( q.y );
    vec2 d = min( vec2( dot(a,a), s*(p.x*q.y-p.y*q.x) ),
                  vec2( dot(b,b), s*(p.y-q.y)  ));
    return -sqrt(d.x)*sign(d.y);
}

float opSmoothUnion( float d1, float d2, float k ) {
  float h = clamp( 0.5 + 0.5*(d2-d1)/k, 0.0, 1.0 );
  return mix( d2, d1, h ) - k*h*(1.0-h);
}

float opUnion( float d1, float d2 ) { return min(d1,d2); }
float opIntersection( float d1, float d2 ) { return max(d1,d2); }
float opSubtraction( float d1, float d2 ) { return max(-d1,d2); }

float sdfBar(vec2 position, vec2 dimensions, vec2 uv, float frequencySample) {
  float w = mix(dimensions.x * 0.5, dimensions.x, smoothstep(0.0, 1.0, frequencySample));
  vec2 basePosition = uv - position + vec2(0.0, -dimensions.y * 0.5 - frequencySample * 0.05);

  float d = sdfTrapezoid(
      basePosition,
      dimensions.x * 0.5,
      w, dimensions.y * 0.5);

  return (d > 0.0 ? 0.0 : 1.0);
}

vec2 rotate2D(vec2 pt, float a) {
	float c = cos(a);
  float s = sin(a);

  mat2 r = mat2(c, s, -s, c);

  return r * pt;
}

vec4 DrawBars(vec2 center, vec2 uv) {
  float barWidth = 2.0 * M_PI * CIRCLE_RADIUS / (NUM_BARS * 1.25);

  vec4 resultColour = vec4(1.0, 1.0, 1.0, 0.0);
  vec2 position = vec2(center.x, center.y + CIRCLE_RADIUS);

  for(int i = 0; i < int(NUM_BARS); i++) {
    float frequencyUV = 0.0;
    
    if (float(i) >= NUM_BARS * 0.5) {
      frequencyUV = 1.0 - ((float(i) - (NUM_BARS * 0.5)) / (NUM_BARS * 0.5));
    } else {
      frequencyUV = float(i) / (NUM_BARS * 0.5);
    }

    float frequencyData = texture(audioDataTexture, vec2(frequencyUV, 0.0)).x;

    float barFinalHeight = BAR_HEIGHT * (0.1 + 0.9 * frequencyData);
    vec2 barDimensions = vec2(barWidth, barFinalHeight);
    vec2 barUvs = rotate2D(uv - center, (2.0 * M_PI * float(i)) / NUM_BARS) + center;

    resultColour.w += sdfBar(position, barDimensions, barUvs, frequencyData);
  }

  float d = saturate(1.1 * ((distance(uv, center) - CIRCLE_RADIUS) / BAR_HEIGHT));
  d = smoothstep(0.0, 1.0, d);
  d = 0.45 + 0.55 * d;
  resultColour.xyz *= pal(d, vec3(0.5,0.5,0.5),vec3(0.5,0.5,0.5),vec3(1.0,1.0,1.0),vec3(0.0,0.20,0.30) );
  resultColour.xyz *= resultColour.w;

  return saturate(resultColour);
}


vec4 AudioVisualizer() {
  float aspect = iResolution.x / iResolution.y;
  vec2 uv = vUv * vec2(aspect, 1.0);

  vec2 circleCenter = vec2(aspect * 0.5, 0.5);

  return DrawBars(circleCenter, uv);
}
`;


function clamp(x, a, b) {
  return Math.min(Math.max(x, a), b);
}

const KEYS = {
  'a': 65,
  's': 83,
  'w': 87,
  'd': 68,
};

class InputController {
  constructor(target) {
    this.target_ = target || document;
    this.initialize_();    
  }

  initialize_() {
    this.current_ = {
      leftButton: false,
      rightButton: false,
      mouseXDelta: 0,
      mouseYDelta: 0,
      mouseX: 0,
      mouseY: 0,
    };
    this.previous_ = null;
    this.keys_ = {};
    this.previousKeys_ = {};
    this.target_.addEventListener('mousedown', (e) => this.onMouseDown_(e), false);
    this.target_.addEventListener('mousemove', (e) => this.onMouseMove_(e), false);
    this.target_.addEventListener('mouseup', (e) => this.onMouseUp_(e), false);
    this.target_.addEventListener('keydown', (e) => this.onKeyDown_(e), false);
    this.target_.addEventListener('keyup', (e) => this.onKeyUp_(e), false);
  }

  onMouseMove_(e) {
    this.current_.mouseX = e.pageX - window.innerWidth / 2;
    this.current_.mouseY = e.pageY - window.innerHeight / 2;

    if (this.previous_ === null) {
      this.previous_ = {...this.current_};
    }

    this.current_.mouseXDelta = this.current_.mouseX - this.previous_.mouseX;
    this.current_.mouseYDelta = this.current_.mouseY - this.previous_.mouseY;
  }

  onMouseDown_(e) {
    this.onMouseMove_(e);

    switch (e.button) {
      case 0: {
        this.current_.leftButton = true;
        break;
      }
      case 2: {
        this.current_.rightButton = true;
        break;
      }
    }
  }

  onMouseUp_(e) {
    this.onMouseMove_(e);

    switch (e.button) {
      case 0: {
        this.current_.leftButton = false;
        break;
      }
      case 2: {
        this.current_.rightButton = false;
        break;
      }
    }
  }

  onKeyDown_(e) {
    this.keys_[e.keyCode] = true;
  }

  onKeyUp_(e) {
    this.keys_[e.keyCode] = false;
  }

  key(keyCode) {
    return !!this.keys_[keyCode];
  }

  isReady() {
    return this.previous_ !== null;
  }

  update(_) {
    if (this.previous_ !== null) {
      this.current_.mouseXDelta = this.current_.mouseX - this.previous_.mouseX;
      this.current_.mouseYDelta = this.current_.mouseY - this.previous_.mouseY;

      this.previous_ = {...this.current_};
    }
  }
};



class FirstPersonCamera {
  constructor(camera, objects) {
    this.camera_ = camera;
    this.input_ = new InputController();
    this.phi_ = 0;
    this.phiSpeed_ = 8;
    this.theta_ = 0;
    this.thetaSpeed_ = 5;
    this.movementSpeed_ = 10;
    this.rotation_ = new THREE.Quaternion();
    this.translation_ = new THREE.Vector3(30, 2, 0);
    this.bobTimer_ = 0;
    this.bobMagnitude_ = 0.175;
    this.bobFrequency_ = 10;
    this.objects_ = objects;
  }

  update(timeElapsedS) {
    if (this.input_.isReady()) {
      this.updateRotation_(timeElapsedS);
      this.updateTranslation_(timeElapsedS);
      this.updateBob_(timeElapsedS);
      this.updateCamera_(timeElapsedS);
    }

    this.input_.update(timeElapsedS);
  }

  updateBob_(timeElapsedS) {
    if (this.bobActive_) {
      const waveLength = Math.PI;
      const nextStep = 1 + Math.floor(((this.bobTimer_ + 0.000001) * this.bobFrequency_) / waveLength);
      const nextStepTime = nextStep * waveLength / this.bobFrequency_;
      this.bobTimer_ = Math.min(this.bobTimer_ + timeElapsedS, nextStepTime);

      if (this.bobTimer_ == nextStepTime) {
        this.bobActive_ = false;
        this.bobTimer_ = 0;
      }
    }
  }

  updateCamera_(timeElapsedS) {
    this.camera_.quaternion.copy(this.rotation_);
    this.camera_.position.copy(this.translation_);
    this.camera_.position.y += Math.sin(this.bobTimer_ * this.bobFrequency_) * this.bobMagnitude_;

    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(this.rotation_);

    const dir = forward.clone();

    forward.multiplyScalar(100);
    forward.add(this.translation_);

    let closest = forward;
    const result = new THREE.Vector3();
    const ray = new THREE.Ray(this.translation_, dir);
    for (let i = 0; i < this.objects_.length; ++i) {
      if (ray.intersectBox(this.objects_[i], result)) {
        if (result.distanceTo(ray.origin) < closest.distanceTo(ray.origin)) {
          closest = result.clone();
        }
      }
    }

    this.camera_.lookAt(closest);
  }

  updateTranslation_(timeElapsedS) {
    const forwardVelocity = ((this.input_.key(KEYS.w) ? 1 : 0) + (this.input_.key(KEYS.s) ? -1 : 0));
    const strafeVelocity = ((this.input_.key(KEYS.a) ? 1 : 0) + (this.input_.key(KEYS.d) ? -1 : 0));

    const qx = new THREE.Quaternion();
    qx.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.phi_);
    
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(qx);
    forward.multiplyScalar(forwardVelocity * this.movementSpeed_ * timeElapsedS);

    const left = new THREE.Vector3(-1, 0, 0);
    left.applyQuaternion(qx);
    left.multiplyScalar(strafeVelocity * this.movementSpeed_ * timeElapsedS);

    this.translation_.add(forward);
    this.translation_.add(left);

    if(forwardVelocity != 0 || strafeVelocity != 0) {
      this.bobActive_ = true;
    }
  }

  updateRotation_(timeElapsedS) {
    const xh = this.input_.current_.mouseXDelta / window.innerWidth;
    const yh = this.input_.current_.mouseYDelta / window.innerHeight;

    this.phi_ += -xh * this.phiSpeed_;
    this.theta_ = clamp(this.theta_ + -yh * this.thetaSpeed_, -Math.PI / 3, Math.PI / 3);

    // console.log(this.input_.current_.mouseYDelta);

    const qx = new THREE.Quaternion();
    qx.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.phi_);
    const qz = new THREE.Quaternion();
    qz.setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.theta_);

    const q = new THREE.Quaternion();
    q.multiply(qx);
    q.multiply(qz);

    const t = 1.0 - Math.pow(0.001, 5 * timeElapsedS);
    this.rotation_.slerp(q, t);
  }
};



class LinearSpline {
  constructor(lerp) {
    this.points_ = [];
    this._lerp = lerp;
  }

  AddPoint(t, d) {
    this.points_.push([t, d]);
  }

  Get(t) {
    let p1 = 0;

    for (let i = 0; i < this.points_.length; i++) {
      if (this.points_[i][0] >= t) {
        break;
      }
      p1 = i;
    }

    const p2 = Math.min(this.points_.length - 1, p1 + 1);

    if (p1 == p2) {
      return this.points_[p1][1];
    }

    return this._lerp(
        (t - this.points_[p1][0]) / (
            this.points_[p2][0] - this.points_[p1][0]),
        this.points_[p1][1], this.points_[p2][1]);
  }
}


class FirstPersonCameraDemo {
  constructor() {
    this.initialize_();
  }

  initialize_() {
    this.initializeRenderer_();
    this.initializeScene_();
    this.initializePostFX_();
    this.initializeAudio_();

    this.previousRAF_ = null;
    this.raf_();
    this.onWindowResize_();
  }

  initializeAudio_() {
    this.listener_ = new THREE.AudioListener();
    this.camera_.add(this.listener_);

    const sound1 = new THREE.PositionalAudio(this.listener_);
    const sound2 = new THREE.PositionalAudio(this.listener_);

    this.speakerMesh1_.add(sound1);
    this.speakerMesh2_.add(sound2);

    const loader = new THREE.AudioLoader();
    loader.load('resources/music/Ectoplasm.mp3', (buffer) => {
      setTimeout(() => {
        sound1.setBuffer(buffer);
        sound1.setLoop(true);
        sound1.setVolume(1.0);
        sound1.setRefDistance(1);
        sound1.play();
        this.analyzer1_ = new THREE.AudioAnalyser(sound1, 32);
        this.analyzer1Data_ = [];
      }, 5000);
    });

    loader.load('resources/music/AcousticRock.mp3', (buffer) => {
      setTimeout(() => {
        sound2.setBuffer(buffer);
        sound2.setLoop(true);
        sound2.setVolume(1.0);
        sound2.setRefDistance(1);
        sound2.play();
        this.analyzer2_ = new THREE.AudioAnalyser(sound2, 128);
        this.analyzer2Texture_ = new THREE.DataTexture(
            this.analyzer2_.data, 64, 1, THREE.RedFormat);
        this.analyzer2Texture_.magFilter = THREE.LinearFilter;
      }, 5000);
    });

    this.indexTimer_ = 0;
    this.noise1_ = new noise.Noise({
      octaves: 3,
      persistence: 0.5,
      lacunarity: 1.6,
      exponentiation: 1.0,
      height: 1.0,
      scale: 0.1,
      seed: 1
    });
  }

  initializeScene_() {
    const distance = 50.0;
    const angle = Math.PI / 4.0;
    const penumbra = 0.5;
    const decay = 1.0;

    let light = null;
    
    light = new THREE.SpotLight(
      0xFFFFFF, 100.0, distance, angle, penumbra, decay);
    light.castShadow = true;
    light.shadow.bias = -0.00001;
    light.shadow.mapSize.width = 4096;
    light.shadow.mapSize.height = 4096;
    light.shadow.camera.near = 1;
    light.shadow.camera.far = 100;
    light.position.set(-35, 25, 0);
    light.target.position.set(-40, 4, 0);
    this.scene_.add(light);
    this.scene_.add(light.target);

    light = new THREE.SpotLight(
        0xFFFFFF, 100.0, distance, angle, penumbra, decay);
    light.castShadow = true;
    light.shadow.bias = -0.00001;
    light.shadow.mapSize.width = 4096;
    light.shadow.mapSize.height = 4096;
    light.shadow.camera.near = 1;
    light.shadow.camera.far = 100;
    light.position.set(35, 25, 0);
    light.target.position.set(40, 4, 0);
    this.scene_.add(light);
    this.scene_.add(light.target);

    const upColour = 0xFFFF80;
    const downColour = 0x808080;
    light = new THREE.HemisphereLight(upColour, downColour, 0.5);
    light.color.setHSL( 0.6, 1, 0.6 );
    light.groundColor.setHSL( 0.095, 1, 0.75 );
    light.position.set(0, 4, 0);
    this.scene_.add(light);

    const loader = new THREE.CubeTextureLoader();
    const texture = loader.load([
        './resources/skybox/posx.jpg',
        './resources/skybox/negx.jpg',
        './resources/skybox/posy.jpg',
        './resources/skybox/negy.jpg',
        './resources/skybox/posz.jpg',
        './resources/skybox/negz.jpg',
    ]);

    texture.encoding = THREE.sRGBEncoding;
    this.scene_.background = texture;

    const mapLoader = new THREE.TextureLoader();
    const maxAnisotropy = this.threejs_.capabilities.getMaxAnisotropy();

    const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(100, 100, 10, 10),
        this.loadMaterial_('rustediron2_', 4));
    plane.castShadow = false;
    plane.receiveShadow = true;
    plane.rotation.x = -Math.PI / 2;
    this.scene_.add(plane);

    const concreteMaterial = this.loadMaterial_('concrete3-', 4);

    const wall1 = new THREE.Mesh(
      new THREE.BoxGeometry(100, 100, 4),
      concreteMaterial);
    wall1.position.set(0, -40, -50);
    wall1.castShadow = true;
    wall1.receiveShadow = true;
    this.scene_.add(wall1);

    const wall2 = new THREE.Mesh(
      new THREE.BoxGeometry(100, 100, 4),
      concreteMaterial);
    wall2.position.set(0, -40, 50);
    wall2.castShadow = true;
    wall2.receiveShadow = true;
    this.scene_.add(wall2);

    const wall3 = new THREE.Mesh(
      new THREE.BoxGeometry(4, 100, 100),
      concreteMaterial);
    wall3.position.set(50, -40, 0);
    wall3.castShadow = true;
    wall3.receiveShadow = true;
    this.scene_.add(wall3);

    const wall4 = new THREE.Mesh(
      new THREE.BoxGeometry(4, 100, 100),
      concreteMaterial);
    wall4.position.set(-50, -40, 0);
    wall4.castShadow = true;
    wall4.receiveShadow = true;
    this.scene_.add(wall4);

    const speaker1Material = this.loadMaterial_('worn_metal4_', 1);
    const speaker1 = new THREE.Mesh(
      new THREE.BoxGeometry(1, 8, 4),
      speaker1Material);
    speaker1.position.set(-40, 4, 0);
    speaker1.castShadow = true;
    speaker1.receiveShadow = true;
    this.scene_.add(speaker1);

    const speaker1Geo = new THREE.BoxGeometry(0.25, 0.25, 0.25);
    const speaker1BoxMaterial = this.loadMaterial_('broken_down_concrete2_', 1);
    this.speakerMeshes1_ = [];
    const speaker1Group = new THREE.Group();
    speaker1Group.position.x = 0.5 + 0.125;

    for (let x = -5; x <= 5; ++x) {
      const row = [];
      for (let y = 0; y < 16; ++y) {
        const speaker1_1 = new THREE.Mesh(
          speaker1Geo,
          speaker1BoxMaterial.clone());
        speaker1_1.position.set(0, y*0.35 - 3, x * 0.35);
        speaker1_1.castShadow = true;
        speaker1_1.receiveShadow = true;
        speaker1Group.add(speaker1_1);
        row.push(speaker1_1);
      }
      this.speakerMeshes1_.push(row);
    }
    speaker1.add(speaker1Group);

    this.speakerMesh1_ = speaker1;

    const speaker2 = new THREE.Mesh(
      new THREE.BoxGeometry(1, 8, 4),
      new THREE.MeshStandardMaterial({color: 0x404040, roughness: 0.1, metalness: 0 }));
      speaker2.position.set(40, 4, 0);
    speaker2.castShadow = true;
    speaker2.receiveShadow = true;
    this.scene_.add(speaker2);

    this.speakerMesh2_ = speaker2;

    const diffuseMap = mapLoader.load('resources/background-grey-dots.png');
    diffuseMap.anisotropy = maxAnisotropy;
  
    const visualizerMaterial = new THREE.MeshStandardMaterial({
      map: diffuseMap,
      normalMap: mapLoader.load('resources/freepbr/flaking-plaster_normal-ogl.png'),
      roughnessMap: mapLoader.load('resources/freepbr/flaking-plaster_roughness.png'),
      metalnessMap: mapLoader.load('resources/freepbr/flaking-plaster_metallic.png'),
    });

    visualizerMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.iTime = { value: 0.0 };
      shader.uniforms.iResolution = {value: new THREE.Vector2(128, 256)};
      shader.uniforms.audioDataTexture = {value: null};

      shader.fragmentShader = shader.fragmentShader.replace('void main()', FS_DECLARATIONS + 'void main()');
      shader.fragmentShader = shader.fragmentShader.replace('totalEmissiveRadiance = emissive;', `
      
      totalEmissiveRadiance = emissive + AudioVisualizer().xyz;

      `);
      visualizerMaterial.userData.shader = shader;
    };

    visualizerMaterial.customProgramCacheKey = () => {
      return 'visualizerMaterial';
    };

    this.speaker2Material_ = visualizerMaterial;

    const speaker2Screen = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 8),
      this.speaker2Material_);
    speaker2Screen.castShadow = false;
    speaker2Screen.receiveShadow = true;
    speaker2Screen.rotation.y = -Math.PI / 2;
    speaker2Screen.position.x -= 0.51;
    this.speakerMesh2_.add(speaker2Screen);

    // Create Box3 for each mesh in the scene so that we can
    // do some easy intersection tests.
    const meshes = [
      plane, wall1, wall2, wall3, wall4];

    this.objects_ = [];

    for (let i = 0; i < meshes.length; ++i) {
      const b = new THREE.Box3();
      b.setFromObject(meshes[i]);
      this.objects_.push(b);
    }

    this.fpsCamera_ = new FirstPersonCamera(this.camera_, this.objects_);

    // Crosshair
    const crosshair = mapLoader.load('resources/crosshair.png');
    crosshair.anisotropy = maxAnisotropy;

    this.sprite_ = new THREE.Sprite(
      new THREE.SpriteMaterial({map: crosshair, color: 0xffffff, fog: false, depthTest: false, depthWrite: false}));
    this.sprite_.scale.set(0.15, 0.15 * this.camera_.aspect, 1)
    this.sprite_.position.set(0, 0, -10);

    // this.uiScene_.add(this.sprite_);
  }

  loadMaterial_(name, tiling) {
    const mapLoader = new THREE.TextureLoader();
    const maxAnisotropy = this.threejs_.capabilities.getMaxAnisotropy();

    const metalMap = mapLoader.load('resources/freepbr/' + name + 'metallic.png');
    metalMap.anisotropy = maxAnisotropy;
    metalMap.wrapS = THREE.RepeatWrapping;
    metalMap.wrapT = THREE.RepeatWrapping;
    metalMap.repeat.set(tiling, tiling);

    const albedo = mapLoader.load('resources/freepbr/' + name + 'albedo.png');
    albedo.anisotropy = maxAnisotropy;
    albedo.wrapS = THREE.RepeatWrapping;
    albedo.wrapT = THREE.RepeatWrapping;
    albedo.repeat.set(tiling, tiling);

    const normalMap = mapLoader.load('resources/freepbr/' + name + 'normal.png');
    normalMap.anisotropy = maxAnisotropy;
    normalMap.wrapS = THREE.RepeatWrapping;
    normalMap.wrapT = THREE.RepeatWrapping;
    normalMap.repeat.set(tiling, tiling);

    const roughnessMap = mapLoader.load('resources/freepbr/' + name + 'roughness.png');
    roughnessMap.anisotropy = maxAnisotropy;
    roughnessMap.wrapS = THREE.RepeatWrapping;
    roughnessMap.wrapT = THREE.RepeatWrapping;
    roughnessMap.repeat.set(tiling, tiling);

    const material = new THREE.MeshStandardMaterial({
      metalnessMap: metalMap,
      map: albedo,
      normalMap: normalMap,
      roughnessMap: roughnessMap,
    });

    return material;
  }

  initializeRenderer_() {
    this.threejs_ = new THREE.WebGLRenderer({
      antialias: false,
    });
    this.threejs_.shadowMap.enabled = true;
    this.threejs_.shadowMap.type = THREE.PCFSoftShadowMap;
    this.threejs_.setPixelRatio(window.devicePixelRatio);
    this.threejs_.setSize(window.innerWidth, window.innerHeight);
    this.threejs_.physicallyCorrectLights = true;
    this.threejs_.autoClear = false;

    document.body.appendChild(this.threejs_.domElement);

    window.addEventListener('resize', () => {
      this.onWindowResize_();
    }, false);

    const fov = 60;
    const aspect = 1920 / 1080;
    const near = 1.0;
    const far = 1000.0;
    this.camera_ = new THREE.PerspectiveCamera(fov, aspect, near, far);
    this.camera_.position.set(-30, 2, 0);

    this.scene_ = new THREE.Scene();

    this.uiCamera_ = new THREE.OrthographicCamera(
        -1, 1, 1 * aspect, -1 * aspect, 1, 1000);
    this.uiScene_ = new THREE.Scene();
  }

  initializePostFX_() {
    const parameters = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
      stencilBuffer: true,
    };
    
    const renderTarget = new THREE.WebGLRenderTarget(
        window.innerWidth, window.innerHeight, parameters);

    this.composer_ = new EffectComposer(this.threejs_, renderTarget);
    this.composer_.setPixelRatio(window.devicePixelRatio);
    this.composer_.setSize(window.innerWidth, window.innerHeight);

    this.fxaaPass_ = new ShaderPass(FXAAShader);

    const uiPass = new RenderPass(this.uiScene_, this.uiCamera_);
    uiPass.clear = false;

    this.composer_.addPass(new RenderPass(this.scene_, this.camera_));
    this.composer_.addPass(uiPass);
    this.composer_.addPass(new ShaderPass(GammaCorrectionShader));
    this.composer_.addPass(this.fxaaPass_);
  }

  onWindowResize_() {
    this.camera_.aspect = window.innerWidth / window.innerHeight;
    this.camera_.updateProjectionMatrix();

    this.uiCamera_.left = -this.camera_.aspect;
    this.uiCamera_.right = this.camera_.aspect;
    this.uiCamera_.updateProjectionMatrix();

    this.threejs_.setSize(window.innerWidth, window.innerHeight);
    this.composer_.setSize(window.innerWidth, window.innerHeight);

    const pixelRatio = this.threejs_.getPixelRatio();
    this.fxaaPass_.material.uniforms['resolution'].value.x = 1 / (
        window.innerWidth * pixelRatio);
    this.fxaaPass_.material.uniforms['resolution'].value.y = 1 / (
        window.innerHeight * pixelRatio);
  }

  raf_() {
    requestAnimationFrame((t) => {
      if (this.previousRAF_ === null) {
        this.previousRAF_ = t;
      }

      this.step_(t - this.previousRAF_);
      this.composer_.render();

      this.previousRAF_ = t;
      this.raf_();
    });
  }

  step_(timeElapsed) {
    const timeElapsedS = timeElapsed * 0.001;

    this.fpsCamera_.update(timeElapsedS);

    if (this.analyzer1_) {
      this.indexTimer_ += timeElapsedS * 0.1;

      this.analyzer1Data_.push([...this.analyzer1_.getFrequencyData()]);
      const rows = this.speakerMeshes1_.length;
      if (this.analyzer1Data_.length > rows) {
        this.analyzer1Data_.shift();
      }

      const colourSpline = new LinearSpline((t, a, b) => {
        const c = a.clone();
        return c.lerp(b, t);
      });
      colourSpline.AddPoint(0.0, new THREE.Color(0x4040FF));
      colourSpline.AddPoint(0.25, new THREE.Color(0xFF4040));
      colourSpline.AddPoint(1.0, new THREE.Color(0xFFFF80));

      const remap = [15, 13, 11, 9, 7, 5, 3, 1, 0, 2, 4, 6, 8, 10, 12, 14];
      for (let r = 0; r < this.analyzer1Data_.length; ++r) {
        const data = this.analyzer1Data_[r];
        const speakerRow = this.speakerMeshes1_[r];
        for (let i = 0; i < data.length; ++i) {
          const freqScale = math.smootherstep((data[remap[i]]/255) ** 0.5, 0, 1);
          const sc = 1 + 6 * freqScale + this.noise1_.Get(this.indexTimer_, r * 0.42142, i * 0.3455);
          speakerRow[i].scale.set(sc, 1, 1);
          speakerRow[i].material.color.copy(colourSpline.Get(freqScale));
          speakerRow[i].material.emissive.copy(colourSpline.Get(freqScale));
          speakerRow[i].material.emissive.multiplyScalar(freqScale ** 2);
        }  
      }
    }

    if (this.analyzer2_ && this.speaker2Material_ && this.speaker2Material_.userData.shader) {
      this.analyzer2_.getFrequencyData();
      this.speaker2Material_.userData.shader.uniforms.audioDataTexture.value = this.analyzer2Texture_;
      this.speaker2Material_.userData.shader.uniforms.iTime.value += timeElapsedS;
      this.speaker2Material_.userData.shader.uniforms.audioDataTexture.value.needsUpdate = true;
    }
  }
}


let _APP = null;

window.addEventListener('DOMContentLoaded', () => {
  const _Setup = () => {
    _APP = new FirstPersonCameraDemo();
    document.body.removeEventListener('click', _Setup);
  };
  document.body.addEventListener('click', _Setup);
});
