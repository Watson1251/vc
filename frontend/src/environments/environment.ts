// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,
  defaultauth: 'fakebackend',
  firebaseConfig: {
    apiKey: 'AIzaSyCqS9cSPrDCNSQ-Ku2kZf5DBWjPPv7hvcA',
    authDomain: 'test-demo-774f8.firebaseapp.com',
    databaseURL: 'https://test-demo-774f8-default-rtdb.firebaseio.com',
    projectId: 'test-demo-774f8',
    storageBucket: 'test-demo-774f8.appspot.com',
    messagingSenderId: '916438010670',
    appId: '1:916438010670:web:c70cf404da6c0fe7b048bf',
    measurementId: 'G-1N6FB2GG55',
  },
  apiUrl: 'http://10.13.13.161:3005/api',
  socketPath: '/ws/',
  useDynamicSocketUrl: true,
  rsaPublicKey: `-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA5hKk3BeWMJ+C3++fzH+C\nlIAbaUR0q+IMzooydG+tjceBfLIE0yPG5PJD3ta1KcvUpGkU/6FxCnC7cwvnQ0Bh\nsvYKBFaQRNRfsSzhWvM8VBf9G3nHZIjdIdqbKjbrzys0SN3zYKPq0xdcmaN7qvoa\n65y+OLwcApNkQLqcNDr+H1f0T5YbIUwFWdW0MMgWlUTXLvnopa2/U6ROkAyI6fiI\nKDWiSLAeFldZ+IIdxY99ejuyfyGat8yI7SlxM/M4VabgAP32ghlilR8ylmGiI+pA\nqcKk560enQLdqYmL4WN04EdN9YkQ1/1jqWL5lNEHe/c0iWg215LXBsITJuKhRytM\njQIDAQAB\n-----END PUBLIC KEY-----\n`
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
