import CryptoKit
import Foundation
import LocalAuthentication

private let reuseSeconds: TimeInterval = 300
private var context: LAContext?
private var contextAt = Date.distantPast
private let lock = NSLock()

private func fail(_ error: Error, _ message: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>) -> Int32 {
    let ns = error as NSError
    message.pointee = strdup(ns.localizedDescription)
    if let la = error as? LAError, la.code == .userCancel || la.code == .appCancel || la.code == .systemCancel { return 1 }
    if ns.domain == NSOSStatusErrorDomain && ns.code == Int(errSecUserCanceled) { return 1 }
    if ns.domain == LAErrorDomain && (ns.code == LAError.userCancel.rawValue || ns.code == LAError.systemCancel.rawValue) { return 1 }
    return 2
}

private func copyOut(_ data: Data, _ out: UnsafeMutablePointer<UnsafeMutablePointer<UInt8>?>, _ len: UnsafeMutablePointer<Int>) {
    let p = malloc(max(data.count, 1))!.assumingMemoryBound(to: UInt8.self)
    data.copyBytes(to: p, count: data.count)
    out.pointee = p
    len.pointee = data.count
}

private func authContext(_ reason: String) -> LAContext {
    if let c = context, Date().timeIntervalSince(contextAt) < reuseSeconds { return c }
    let c = LAContext()
    c.localizedReason = reason
    c.touchIDAuthenticationAllowableReuseDuration = reuseSeconds
    context = c
    contextAt = Date()
    return c
}

@_cdecl("kc_available")
public func kcAvailable() -> Int32 {
    SecureEnclave.isAvailable ? 1 : 0
}

@_cdecl("kc_create")
public func kcCreate(
    _ presence: Int32,
    _ blob: UnsafeMutablePointer<UnsafeMutablePointer<UInt8>?>,
    _ blobLen: UnsafeMutablePointer<Int>,
    _ point: UnsafeMutablePointer<UnsafeMutablePointer<UInt8>?>,
    _ pointLen: UnsafeMutablePointer<Int>,
    _ message: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>
) -> Int32 {
    do {
        var flags: SecAccessControlCreateFlags = [.privateKeyUsage]
        if presence != 0 { flags.insert(.userPresence) }
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, flags, &error) else {
            throw error!.takeRetainedValue() as Error
        }
        let key = try SecureEnclave.P256.Signing.PrivateKey(accessControl: access)
        copyOut(key.dataRepresentation, blob, blobLen)
        copyOut(key.publicKey.x963Representation, point, pointLen)
        return 0
    } catch {
        return fail(error, message)
    }
}

@_cdecl("kc_sign")
public func kcSign(
    _ blob: UnsafePointer<UInt8>,
    _ blobLen: Int,
    _ data: UnsafePointer<UInt8>,
    _ dataLen: Int,
    _ reason: UnsafePointer<CChar>,
    _ sig: UnsafeMutablePointer<UnsafeMutablePointer<UInt8>?>,
    _ sigLen: UnsafeMutablePointer<Int>,
    _ message: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>
) -> Int32 {
    lock.lock()
    defer { lock.unlock() }
    do {
        let ctx = authContext(String(cString: reason))
        let key = try SecureEnclave.P256.Signing.PrivateKey(
            dataRepresentation: Data(bytes: blob, count: blobLen), authenticationContext: ctx)
        let signature = try key.signature(for: Data(bytes: data, count: dataLen))
        copyOut(signature.derRepresentation, sig, sigLen)
        return 0
    } catch {
        context = nil
        return fail(error, message)
    }
}

@_cdecl("kc_forget")
public func kcForget() {
    lock.lock()
    context?.invalidate()
    context = nil
    lock.unlock()
}

@_cdecl("kc_free")
public func kcFree(_ p: UnsafeMutableRawPointer?) {
    free(p)
}
