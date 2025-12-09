/**
 * Environment configuration.
 */
export const env = {
  debugBackend: import.meta.env.PUBLIC_DEBUG_BACKEND === 'true',
  debugShowSnackbarTimer:
    import.meta.env.PUBLIC_DEBUG_SHOW_SNACKBAR_TIMER === 'true',
};
