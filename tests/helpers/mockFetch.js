/**
 * Mock fetch utility for testing API calls
 */

/**
 * Create a mock fetch function that returns predefined responses.
 * @param {Object} responses - Map of URL patterns to responses
 * @returns {Function} Mock fetch function
 */
function createMockFetch(responses = {}) {
    return jest.fn(async (url, options = {}) => {
        // Find matching response
        for (const [pattern, response] of Object.entries(responses)) {
            if (url.includes(pattern)) {
                if (typeof response === 'function') {
                    return response(url, options);
                }

                const { status = 200, data, error } = response;

                if (error) {
                    throw new Error(error);
                }

                return {
                    ok: status >= 200 && status < 300,
                    status,
                    json: async () => data,
                    text: async () => JSON.stringify(data),
                };
            }
        }

        // Default: return 404
        return {
            ok: false,
            status: 404,
            json: async () => ({ error: 'Not found' }),
            text: async () => 'Not found',
        };
    });
}

/**
 * Create a successful JSON response
 */
function jsonResponse(data, status = 200) {
    return {
        status,
        data,
    };
}

/**
 * Create an error response
 */
function errorResponse(message, status = 500) {
    return {
        status,
        data: { error: message, detail: message },
    };
}

/**
 * Create a TorBox-style successful response
 */
function torboxSuccess(data) {
    return {
        status: 200,
        data: { success: true, data },
    };
}

/**
 * Create a TorBox-style error response
 */
function torboxError(detail, status = 400) {
    return {
        status,
        data: { success: false, detail },
    };
}

/**
 * Setup global fetch mock for a test
 */
function setupFetchMock(responses) {
    const mockFetch = createMockFetch(responses);
    global.fetch = mockFetch;
    return mockFetch;
}

/**
 * Restore global fetch (call in afterEach)
 */
function restoreFetch() {
    if (global.fetch && global.fetch.mockRestore) {
        global.fetch.mockRestore();
    }
}

module.exports = {
    createMockFetch,
    jsonResponse,
    errorResponse,
    torboxSuccess,
    torboxError,
    setupFetchMock,
    restoreFetch,
};
