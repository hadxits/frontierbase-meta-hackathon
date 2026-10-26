const LogSeverity = {
  /**
   * The log entry has no assigned severity level.
   */
  DEFAULT: {
    label: 'DEFAULT',
    level: 0,
  },
  /**
   * Debug or trace information
   */
  DEBUG: {
    label: 'DEBUG',
    level: 100,
  },
  /**
   * Routine information, such as ongoing status
   */
  INFO: {
    label: 'INFO',
    level: 200,
  },
  /**
   * Normal but significant events, such as start up, shut down, or a configuration change.
   */
  NOTICE: {
    label: 'NOTICE',
    level: 300,
  },
  /**
   * Warning events might cause problems
   */
  WARNING: {
    label: 'WARNING',
    level: 400,
  },
  /**
   * Error events are likely to cause problems
   */
  ERROR: {
    label: 'ERROR',
    level: 500,
  },
  /**
   * Critical events cause more severe problems or outages
   */
  CRITICAL: {
    label: 'CRITICAL',
    level: 600,
  },
  /**
   * A person must take an action immediately
   */
  ALERT: {
    label: 'ALERT',
    level: 700,
  },
  /**
   * One or more systems are unusable
   */
  EMERGENCY: {
    label: 'EMERGENCY',
    level: 800,
  },
};

module.exports = LogSeverity;