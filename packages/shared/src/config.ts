// Environment Config Helper (fail-fast)

export const getEnv = (key: string): string => {
    const value = process.env[key];
    if (!value) {
      throw new Error(`❌ Missing required environment variable: ${key}`);
    }
    return value;
  };
  
  export const getEnvNumber = (key: string, defaultValue?: number): number => {
    const value = process.env[key];
    if (!value) {
      if (defaultValue !== undefined) return defaultValue;
      throw new Error(`❌ Missing required environment variable: ${key}`);
    }
    const num = parseInt(value, 10);
    if (isNaN(num)) throw new Error(`❌ Invalid number in env var ${key}: ${value}`);
    return num;
  };