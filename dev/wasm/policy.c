// Fixed-memory MLP kernel. Shape/order matches policy/mlp-inference.js.
// No imports, allocation, WASI, threads, or memory growth.
static float weights[13079];
static float input[25], hidden1[128], hidden2[64], output[23];
__attribute__((export_name("weights_ptr"))) float *weights_ptr(void) { return weights; }
__attribute__((export_name("input_ptr"))) float *input_ptr(void) { return input; }
__attribute__((export_name("output_ptr"))) float *output_ptr(void) { return output; }
__attribute__((export_name("parameter_count"))) int parameter_count(void) { return 13079; }
static int dense(const float *x, float *y, int in, int out, int offset, int relu) {
  const float *matrix = weights + offset, *bias = matrix + in * out;
  for (int j = 0; j < out; j++) {
    double sum = 0;
    for (int i = 0; i < in; i++) sum += (double)x[i] * matrix[j * in + i];
    // Match the JS Float32 intermediate rounding before bias addition.
    float z = (float)sum;
    z += bias[j];
    y[j] = relu && z < 0 ? 0 : z;
  }
  return offset + in * out + out;
}
__attribute__((export_name("infer"))) void infer(void) {
  int offset = dense(input, hidden1, 25, 128, 0, 1);
  offset = dense(hidden1, hidden2, 128, 64, offset, 1);
  const int sizes[6] = {5,5,4,4,1,4};
  int result = 0;
  for (int h = 0; h < 6; h++) {
    offset = dense(hidden2, output + result, 64, sizes[h], offset, 0);
    result += sizes[h];
  }
}
