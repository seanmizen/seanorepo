import Foundation

/// The lessdeaf backend API (apps/lessdeaf/server). Every call except
/// `health` sends the key.
struct HomelabClient: Sendable {
    let baseURL: URL
    let key: String

    struct Health: Decodable {
        var ok: Bool
        var sessions: Int
        var uploads: Bool
    }

    /// Checks the server and the key. Returns the number of sessions on the server.
    func check() async throws -> Int {
        let health = try JSONDecoder().decode(Health.self, from: try await send("GET", "api/health"))
        guard health.uploads else { throw HomelabError.uploadsOff }
        // A route that needs the key, so a wrong key fails here.
        _ = try await send("GET", "api/sessions")
        return health.sessions
    }

    func putMetadata(_ id: String, _ json: Data) async throws {
        _ = try await send("PUT", "api/sessions/\(id)", body: json, type: "application/json")
    }

    func putPart(_ id: String, seq: Int, _ pcm: Data) async throws {
        _ = try await send("PUT", "api/sessions/\(id)/audio/\(seq)", body: pcm, type: "application/octet-stream")
    }

    func finishAudio(_ id: String, parts: Int) async throws {
        let body = try JSONEncoder().encode(["parts": parts])
        _ = try await send("POST", "api/sessions/\(id)/audio/finish", body: body, type: "application/json")
    }

    func putTranscript(_ id: String, pipeline: String, _ json: Data) async throws {
        _ = try await send("PUT", "api/sessions/\(id)/transcripts/\(pipeline)", body: json, type: "application/json")
    }

    /// Downloads audio.wav to the caches folder and returns its URL.
    func downloadAudio(_ id: String) async throws -> URL {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let target = caches.appendingPathComponent("\(id).wav")
        if FileManager.default.fileExists(atPath: target.path) { return target }
        let (temp, response) = try await URLSession.shared.download(for: request("GET", "api/sessions/\(id)/audio"))
        try Self.check(response, data: nil)
        try FileManager.default.moveItem(at: temp, to: target)
        return target
    }

    private func request(_ method: String, _ path: String) -> URLRequest {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = method
        request.timeoutInterval = 30
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        return request
    }

    private func send(_ method: String, _ path: String, body: Data? = nil, type: String? = nil) async throws -> Data {
        var request = request(method, path)
        request.httpBody = body
        if let type { request.setValue(type, forHTTPHeaderField: "Content-Type") }
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.check(response, data: data)
        return data
    }

    private static func check(_ response: URLResponse, data: Data?) throws {
        guard let http = response as? HTTPURLResponse else { throw HomelabError.status(0, "No HTTP response.") }
        guard (200..<300).contains(http.statusCode) else {
            let message = data.flatMap { try? JSONDecoder().decode([String: String].self, from: $0)["error"] }
            throw HomelabError.status(http.statusCode, message ?? "HTTP \(http.statusCode)")
        }
    }
}

enum HomelabError: LocalizedError {
    case status(Int, String)
    case uploadsOff

    var errorDescription: String? {
        switch self {
        case .status(_, let message): message
        case .uploadsOff: "The homelab has no LESSDEAF_KEY, so uploads are off."
        }
    }

    /// A 4xx answer (other than 408 and 429) does not change on a retry.
    var isPermanent: Bool {
        if case .status(let code, _) = self { return (400..<500).contains(code) && code != 408 && code != 429 && code != 401 }
        return false
    }
}
