/**
 * Environment configuration.
 */
export const env = {
  debugBackend: import.meta.env.PUBLIC_DEBUG_BACKEND === 'true',
  debugShowSnackbarTimer:
    import.meta.env.PUBLIC_DEBUG_SHOW_SNACKBAR_TIMER === 'true',
  debugShowAttendeeId: import.meta.env.PUBLIC_DEBUG_SHOW_ATTENDEE_ID === 'true',
  debugShowRefreshButton:
    import.meta.env.PUBLIC_DEBUG_SHOW_REFRESH_BUTTON === 'true',
  debugWsUpdates: import.meta.env.PUBLIC_DEBUG_WS_UPDATES === 'true',
  showDisclaimer: import.meta.env.PUBLIC_SHOW_DISCLAIMER === 'true',
  hideCopyUrlButton: import.meta.env.PUBLIC_HIDE_COPY_URL_BUTTON === 'true',
};
