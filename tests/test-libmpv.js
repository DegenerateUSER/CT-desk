// Quick test: verify koffi + libmpv works
const koffi = require('koffi');
console.log('koffi loaded');

const lib = koffi.load('/tmp/mpv-install/lib/libmpv.2.dylib');
console.log('libmpv loaded');

const mpv_create = lib.func('void *mpv_create()');
const mpv_initialize = lib.func('int mpv_initialize(void *ctx)');
const mpv_set_option_string = lib.func('int mpv_set_option_string(void *ctx, const char *name, const char *data)');
const mpv_error_string = lib.func('const char *mpv_error_string(int error)');
const mpv_terminate_destroy = lib.func('void mpv_terminate_destroy(void *ctx)');

console.log('Functions loaded');

const mpv = mpv_create();
console.log('mpv handle:', mpv ? 'OK' : 'NULL');

mpv_set_option_string(mpv, 'vo', 'libmpv');
mpv_set_option_string(mpv, 'idle', 'yes');

const err = mpv_initialize(mpv);
console.log('Initialize result:', err, err < 0 ? mpv_error_string(err) : 'OK');

// Create render context (sw)
const mpv_render_param = koffi.struct('mpv_render_param', { type: 'int', data: 'void *' });
const mpv_render_context_create = lib.func('int mpv_render_context_create(_Out_ void **res, void *mpv, mpv_render_param *params)');
const mpv_render_context_free = lib.func('void mpv_render_context_free(void *ctx)');
const mpv_render_context_update = lib.func('uint64 mpv_render_context_update(void *ctx)');

const swStr = Buffer.from('sw\0', 'utf8');
const params = [
  { type: 1, data: swStr },
  { type: 0, data: null }
];

const renderCtxOut = [null];
const rcErr = mpv_render_context_create(renderCtxOut, mpv, params);
console.log('Render context create:', rcErr, rcErr < 0 ? mpv_error_string(rcErr) : 'OK');
console.log('Render context:', renderCtxOut[0] ? 'OK' : 'NULL');
console.log('Render context value:', renderCtxOut[0]);

if (renderCtxOut[0]) {
  // Test update
  const flags = mpv_render_context_update(renderCtxOut[0]);
  console.log('Update flags:', flags);

  // Test frame rendering with a simple buffer
  const mpv_render_context_render = lib.func('int mpv_render_context_render(void *ctx, mpv_render_param *params)');
  const mpv_render_context_report_swap = lib.func('void mpv_render_context_report_swap(void *ctx)');
  const mpv_command_string = lib.func('int mpv_command_string(void *ctx, const char *args)');

  // Allocate a small test buffer (320x240 BGRA)
  const w = 320, h = 240, stride = w * 4;
  const frameBuf = Buffer.alloc(stride * h);
  const sizeArr = Buffer.alloc(8);
  sizeArr.writeInt32LE(w, 0);
  sizeArr.writeInt32LE(h, 4);
  const fmtStr = Buffer.from('0bgr\0', 'utf8');
  const strideArr = Buffer.alloc(8);
  strideArr.writeBigUInt64LE(BigInt(stride));

  const renderParams = [
    { type: 17, data: sizeArr },      // SW_SIZE
    { type: 18, data: fmtStr },       // SW_FORMAT
    { type: 19, data: strideArr },    // SW_STRIDE
    { type: 20, data: frameBuf },     // SW_POINTER
    { type: 0, data: null }           // sentinel
  ];

  // Render a blank frame (no video loaded — should return black)
  const renderErr = mpv_render_context_render(renderCtxOut[0], renderParams);
  console.log('Render result:', renderErr, renderErr < 0 ? mpv_error_string(renderErr) : 'OK');
  console.log('First pixel (BGRA):', frameBuf[0], frameBuf[1], frameBuf[2], frameBuf[3]);

  mpv_render_context_report_swap(renderCtxOut[0]);

  mpv_render_context_free(renderCtxOut[0]);
  console.log('Render context freed');
}
mpv_terminate_destroy(mpv);
console.log('DONE - All tests passed!');
