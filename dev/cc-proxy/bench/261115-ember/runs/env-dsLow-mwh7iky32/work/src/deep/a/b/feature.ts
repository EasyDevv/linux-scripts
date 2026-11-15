const { APP_FEATURE_FLAGS } = process.env;
export default APP_FEATURE_FLAGS?.split(",");
