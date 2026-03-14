/**
 * Interceptor - XHR and Fetch interception for token capture
 */
const Interceptor = {
  setup() {
    this._interceptXHR();
    this._interceptFetch();
  },

  _interceptXHR() {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;

    XMLHttpRequest.prototype.open = function(method, url, ...args) {
      this._url = url;
      return originalOpen.apply(this, [method, url, ...args]);
    };

    XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
      if (name.toLowerCase() === 'authorization' && value.startsWith('Bearer ')) {
        Store.accessToken = value.substring(7);
      }
      return originalSetHeader.apply(this, [name, value]);
    };
  },

  _interceptFetch() {
    const originalFetch = window.fetch;
    window.fetch = async function(input, init = {}) {
      if (init.headers) {
        const headers = init.headers;
        if (headers instanceof Headers) {
          const auth = headers.get('Authorization');
          if (auth?.startsWith('Bearer ')) {
            Store.accessToken = auth.substring(7);
          }
        } else if (typeof headers === 'object') {
          for (const [key, value] of Object.entries(headers)) {
            if (key.toLowerCase() === 'authorization' && value.startsWith('Bearer ')) {
              Store.accessToken = value.substring(7);
            }
          }
        }
      }
      return originalFetch.apply(this, [input, init]);
    };
  }
};
