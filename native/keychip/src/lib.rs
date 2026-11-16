use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi(object)]
pub struct Created {
    pub algorithm: String,
    pub handle: Buffer,
    pub public_key: Buffer,
}

pub struct Made {
    algorithm: &'static str,
    handle: Vec<u8>,
    public_key: Vec<u8>,
}

pub enum Failure {
    Cancelled,
    Unsupported,
    Other(String),
}

impl From<Failure> for Error {
    fn from(f: Failure) -> Self {
        match f {
            Failure::Cancelled => Error::from_reason("cancelled"),
            Failure::Unsupported => Error::from_reason("unsupported"),
            Failure::Other(m) => Error::from_reason(m),
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{Failure, Made};
    use std::ffi::{c_char, c_void, CStr, CString};
    use std::ptr;

    extern "C" {
        fn kc_available() -> i32;
        fn kc_create(
            presence: i32,
            blob: *mut *mut u8,
            blob_len: *mut usize,
            point: *mut *mut u8,
            point_len: *mut usize,
            message: *mut *mut c_char,
        ) -> i32;
        fn kc_sign(
            blob: *const u8,
            blob_len: usize,
            data: *const u8,
            data_len: usize,
            reason: *const c_char,
            sig: *mut *mut u8,
            sig_len: *mut usize,
            message: *mut *mut c_char,
        ) -> i32;
        fn kc_forget();
        fn kc_free(p: *mut c_void);
    }

    unsafe fn take(p: *mut u8, len: usize) -> Vec<u8> {
        let v = std::slice::from_raw_parts(p, len).to_vec();
        kc_free(p as *mut c_void);
        v
    }

    unsafe fn failure(code: i32, message: *mut c_char) -> Failure {
        let text = if message.is_null() {
            String::from("Secure Enclave error")
        } else {
            let s = CStr::from_ptr(message).to_string_lossy().into_owned();
            kc_free(message as *mut c_void);
            s
        };
        if code == 1 {
            Failure::Cancelled
        } else {
            Failure::Other(text)
        }
    }

    pub fn available() -> bool {
        unsafe { kc_available() == 1 }
    }

    pub fn create(_name: &str, presence: bool) -> Result<Made, Failure> {
        if !available() {
            return Err(Failure::Unsupported);
        }
        unsafe {
            let (mut blob, mut blob_len, mut point, mut point_len) =
                (ptr::null_mut(), 0usize, ptr::null_mut(), 0usize);
            let mut message: *mut c_char = ptr::null_mut();
            let code = kc_create(
                presence as i32,
                &mut blob,
                &mut blob_len,
                &mut point,
                &mut point_len,
                &mut message,
            );
            if code != 0 {
                return Err(failure(code, message));
            }
            Ok(Made {
                algorithm: "p256",
                handle: take(blob, blob_len),
                public_key: take(point, point_len),
            })
        }
    }

    pub fn sign(handle: &[u8], data: &[u8], reason: &str) -> Result<Vec<u8>, Failure> {
        let reason = CString::new(reason.replace('\0', "")).unwrap_or_default();
        unsafe {
            let (mut sig, mut sig_len) = (ptr::null_mut(), 0usize);
            let mut message: *mut c_char = ptr::null_mut();
            let code = kc_sign(
                handle.as_ptr(),
                handle.len(),
                data.as_ptr(),
                data.len(),
                reason.as_ptr(),
                &mut sig,
                &mut sig_len,
                &mut message,
            );
            if code != 0 {
                return Err(failure(code, message));
            }
            Ok(take(sig, sig_len))
        }
    }

    pub fn remove(_handle: &[u8]) -> Result<(), Failure> {
        Ok(())
    }

    pub fn forget() {
        unsafe { kc_forget() }
    }
}

#[cfg(windows)]
mod platform {
    use super::{Failure, Made};
    use windows::core::{Array, HSTRING};
    use windows::Security::Credentials::{
        KeyCredentialCreationOption, KeyCredentialManager, KeyCredentialStatus,
    };
    use windows::Security::Cryptography::Core::CryptographicPublicKeyBlobType;
    use windows::Security::Cryptography::CryptographicBuffer;
    use windows::Storage::Streams::IBuffer;

    fn other(e: windows::core::Error) -> Failure {
        Failure::Other(e.message().to_string())
    }

    fn status(s: KeyCredentialStatus) -> Result<(), Failure> {
        match s {
            KeyCredentialStatus::Success => Ok(()),
            KeyCredentialStatus::UserCanceled => Err(Failure::Cancelled),
            KeyCredentialStatus::NotFound => {
                Err(Failure::Other(String::from("Windows Hello key not found")))
            }
            KeyCredentialStatus::SecurityDeviceLocked => {
                Err(Failure::Other(String::from("Security device locked")))
            }
            KeyCredentialStatus::UserPrefersPassword => Err(Failure::Cancelled),
            _ => Err(Failure::Other(format!("Windows Hello error {}", s.0))),
        }
    }

    fn bytes(buf: &IBuffer) -> Result<Vec<u8>, Failure> {
        let mut out = Array::<u8>::new();
        CryptographicBuffer::CopyToByteArray(buf, &mut out).map_err(other)?;
        Ok(out.to_vec())
    }

    fn name_of(handle: &[u8]) -> Result<HSTRING, Failure> {
        let s =
            std::str::from_utf8(handle).map_err(|_| Failure::Other(String::from("bad handle")))?;
        Ok(HSTRING::from(s))
    }

    pub fn available() -> bool {
        KeyCredentialManager::IsSupportedAsync()
            .and_then(|op| op.get())
            .unwrap_or(false)
    }

    pub fn create(name: &str, _presence: bool) -> Result<Made, Failure> {
        if !available() {
            return Err(Failure::Unsupported);
        }
        let result = KeyCredentialManager::RequestCreateAsync(
            &HSTRING::from(name),
            KeyCredentialCreationOption::ReplaceExisting,
        )
        .and_then(|op| op.get())
        .map_err(other)?;
        status(result.Status().map_err(other)?)?;
        let cred = result.Credential().map_err(other)?;
        let public_key = cred
            .RetrievePublicKeyWithBlobType(CryptographicPublicKeyBlobType::X509SubjectPublicKeyInfo)
            .map_err(other)?;
        Ok(Made {
            algorithm: "rsa2048",
            handle: name.as_bytes().to_vec(),
            public_key: bytes(&public_key)?,
        })
    }

    pub fn sign(handle: &[u8], data: &[u8], _reason: &str) -> Result<Vec<u8>, Failure> {
        let opened = KeyCredentialManager::OpenAsync(&name_of(handle)?)
            .and_then(|op| op.get())
            .map_err(other)?;
        status(opened.Status().map_err(other)?)?;
        let cred = opened.Credential().map_err(other)?;
        let buf = CryptographicBuffer::CreateFromByteArray(data).map_err(other)?;
        let result = cred
            .RequestSignAsync(&buf)
            .and_then(|op| op.get())
            .map_err(other)?;
        status(result.Status().map_err(other)?)?;
        bytes(&result.Result().map_err(other)?)
    }

    pub fn remove(handle: &[u8]) -> Result<(), Failure> {
        KeyCredentialManager::DeleteAsync(&name_of(handle)?)
            .and_then(|op| op.get())
            .map_err(other)
    }

    pub fn forget() {}
}

#[cfg(not(any(target_os = "macos", windows)))]
mod platform {
    use super::{Failure, Made};

    pub fn available() -> bool {
        false
    }
    pub fn create(_name: &str, _presence: bool) -> Result<Made, Failure> {
        Err(Failure::Unsupported)
    }
    pub fn sign(_handle: &[u8], _data: &[u8], _reason: &str) -> Result<Vec<u8>, Failure> {
        Err(Failure::Unsupported)
    }
    pub fn remove(_handle: &[u8]) -> Result<(), Failure> {
        Err(Failure::Unsupported)
    }
    pub fn forget() {}
}

pub struct AvailableTask;

impl Task for AvailableTask {
    type Output = bool;
    type JsValue = bool;

    fn compute(&mut self) -> Result<bool> {
        Ok(platform::available())
    }

    fn resolve(&mut self, _env: Env, output: bool) -> Result<bool> {
        Ok(output)
    }
}

#[napi]
pub fn available() -> AsyncTask<AvailableTask> {
    AsyncTask::new(AvailableTask)
}

pub struct CreateTask {
    name: String,
    presence: bool,
}

impl Task for CreateTask {
    type Output = Made;
    type JsValue = Created;

    fn compute(&mut self) -> Result<Made> {
        platform::create(&self.name, self.presence).map_err(Error::from)
    }

    fn resolve(&mut self, _env: Env, made: Made) -> Result<Created> {
        Ok(Created {
            algorithm: made.algorithm.to_string(),
            handle: made.handle.into(),
            public_key: made.public_key.into(),
        })
    }
}

#[napi]
pub fn create(name: String, presence: bool) -> AsyncTask<CreateTask> {
    AsyncTask::new(CreateTask { name, presence })
}

pub struct SignTask {
    handle: Vec<u8>,
    data: Vec<u8>,
    reason: String,
}

impl Task for SignTask {
    type Output = Vec<u8>;
    type JsValue = Buffer;

    fn compute(&mut self) -> Result<Vec<u8>> {
        platform::sign(&self.handle, &self.data, &self.reason).map_err(Error::from)
    }

    fn resolve(&mut self, _env: Env, output: Vec<u8>) -> Result<Buffer> {
        Ok(output.into())
    }
}

#[napi]
pub fn sign(handle: Buffer, data: Buffer, reason: String) -> AsyncTask<SignTask> {
    AsyncTask::new(SignTask {
        handle: handle.to_vec(),
        data: data.to_vec(),
        reason,
    })
}

pub struct RemoveTask {
    handle: Vec<u8>,
}

impl Task for RemoveTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> Result<()> {
        platform::remove(&self.handle).map_err(Error::from)
    }

    fn resolve(&mut self, _env: Env, _output: ()) -> Result<()> {
        Ok(())
    }
}

#[napi]
pub fn remove(handle: Buffer) -> AsyncTask<RemoveTask> {
    AsyncTask::new(RemoveTask {
        handle: handle.to_vec(),
    })
}

#[napi]
pub fn forget() {
    platform::forget()
}
