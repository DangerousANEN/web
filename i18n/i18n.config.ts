export default defineI18nConfig(() => {
  return {
    fallbackWarn: false,
    // If a key is missing in the active locale, fall back to Russian
    // so keys don't render as raw dot-paths (layouts.app_nav.*).
    fallbackLocale: "ru",
    // Silent missing-key warnings in production — fewer console spams
    // in OBS browser sources.
    missingWarn: false,
  };
});
