use jni::{
    errors::{Result, ThrowRuntimeExAndDefault},
    jni_mangle, jni_sig, jni_str,
    objects::{JByteArray, JObject, JString},
    sys::jint,
    Env, EnvUnowned, JValue,
};
use serde_json::{json, Value};
use zeroize::{Zeroize, Zeroizing};

fn read_fake(env: &mut Env, source: &JObject, mode: jint) -> Result<Zeroizing<Vec<u8>>> {
    let result = env.call_method(
        source,
        jni_str!("readFake"),
        jni_sig!((int) -> byte[]),
        &[JValue::Int(mode)],
    );
    let object = match result {
        Ok(value) => value.l()?,
        Err(error) => {
            // Never stringify a Java exception: a real helper may carry a secret.
            env.exception_clear();
            return Err(error);
        }
    };
    let array = env.cast_local::<JByteArray>(object)?;
    let copied = env.convert_byte_array(&array).map(Zeroizing::new);
    // Clear the Java-owned temporary even if conversion failed.
    let length = array.len(env)?;
    array.set_region(env, 0, &vec![0; length])?;
    copied
}

fn jni_checks(env: &mut Env, source: &JObject) -> Result<Value> {
    let mut bytes = read_fake(env, source, 0)?;
    let read = bytes.as_slice() == b"synthetic-only";
    let java_cleared = env
        .call_method(
            source,
            jni_str!("javaCleared"),
            jni_sig!(() -> boolean),
            &[],
        )?
        .z()?;
    bytes.as_mut_slice().zeroize();
    let rust_cleared = bytes.len() == 14 && bytes.iter().all(|byte| *byte == 0);
    let missing_rejected = read_fake(env, source, 1).is_err();
    let exception_rejected = read_fake(env, source, 2).is_err();
    let recovered =
        !env.exception_check() && read_fake(env, source, 0)?.as_slice() == b"synthetic-only";
    Ok(json!({
        "read": read, "java_cleared": java_cleared, "rust_cleared": rust_cleared,
        "missing_rejected": missing_rejected, "exception_rejected": exception_rejected,
        "recovered": recovered,
    }))
}

#[jni_mangle("dev.plums.tlsprobe.ProbeActivity")]
pub fn runProbe<'local>(
    mut unowned: EnvUnowned<'local>,
    source: JObject<'local>,
    port: jint,
    ca: JByteArray<'local>,
) -> JString<'local> {
    unowned
        .with_env(|env| -> Result<JString> {
            let context = env.new_local_ref(&source)?;
            rustls_platform_verifier::android::init_with_env(env, context)?;
            let ca = env.convert_byte_array(&ca)?;
            let verifier =
                env.find_class(jni_str!("org/rustls/platformverifier/CertificateVerifier"))?;
            let verifier = env.new_global_ref(verifier)?;
            let vm = env.get_java_vm()?;
            let source = env.new_global_ref(source)?;
            // A Rust-created worker must attach itself; no UI-thread/JNIEnv reuse.
            let report = std::thread::spawn(move || {
                vm.attach_current_thread_for_scope(|env| -> Result<Value> {
                    let jni = jni_checks(env, source.as_ref())?;
                    let tls = crate::tls_checks(port as u16, &[], |extra| {
                        let result = if extra {
                            env.byte_array_from_slice(&ca).and_then(|root| {
                                env.call_static_method(
                                    &verifier,
                                    jni_str!("addMockRoot"),
                                    jni_sig!((byte[]) -> void),
                                    &[JValue::Object(&root)],
                                )
                            })
                        } else {
                            env.call_static_method(
                                &verifier,
                                jni_str!("clearMockRoots"),
                                jni_sig!(() -> void),
                                &[],
                            )
                        };
                        if result.is_err() {
                            env.exception_clear();
                        }
                        result.is_ok()
                    });
                    drop(verifier);
                    drop(source);
                    Ok(json!({"platform": "android", "tls": tls, "jni": jni}))
                })
            })
            .join()
            .expect("probe worker panicked")?;
            env.new_string(serde_json::to_string(&report).expect("JSON probe report"))
        })
        .resolve::<ThrowRuntimeExAndDefault>()
}
