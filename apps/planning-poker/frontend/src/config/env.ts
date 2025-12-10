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
};
