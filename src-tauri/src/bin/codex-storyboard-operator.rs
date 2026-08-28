use cap_std::{ambient_authority, fs::{Dir, OpenOptions}};
use image::{GenericImageView, ImageFormat};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, env, fs, io::{Read, Write}, path::{Component, Path}, process, time::{SystemTime, UNIX_EPOCH}};

const PROVIDER: &str = "codex_task_package";

fn fail<T>(code: &str) -> Result<T, String> { Err(code.to_string()) }
fn sha(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
fn normal(relative: &str) -> bool { !relative.is_empty() && Path::new(relative).components().all(|c| matches!(c, Component::Normal(_))) }
fn no_link(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() { return false; }
    #[cfg(windows)] { use std::os::windows::fs::MetadataExt; if metadata.file_attributes() & 0x400 != 0 { return false; } }
    true
}
fn cap_no_link(metadata: &cap_std::fs::Metadata) -> bool { !metadata.file_type().is_symlink() }
fn open_dir(path: &Path, code: &str) -> Result<Dir, String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| code.to_string())?;
    if !metadata.is_dir() || !no_link(&metadata) { return fail(code); }
    Dir::open_ambient_dir(path, ambient_authority()).map_err(|_| code.to_string())
}
fn check_path_components(root: &Path, relative: &str, code: &str) -> Result<(), String> {
    if !normal(relative) { return fail(code); }
    let mut current = root.to_path_buf();
    for component in Path::new(relative).components() {
        current.push(component.as_os_str());
        let metadata = fs::symlink_metadata(&current).map_err(|_| code.to_string())?;
        if !no_link(&metadata) { return fail(code); }
    }
    Ok(())
}
fn stable_read(dir: &Dir, root: &Path, relative: &str, code: &str) -> Result<Vec<u8>, String> {
    check_path_components(root, relative, code)?;
    let metadata = dir.symlink_metadata(relative).map_err(|_| code.to_string())?;
    if !metadata.is_file() || !cap_no_link(&metadata) { return fail(code); }
    let mut file = dir.open(relative).map_err(|_| code.to_string())?.into_std();
    let before = file.metadata().map_err(|_| code.to_string())?;
    let mut bytes = Vec::new(); file.read_to_end(&mut bytes).map_err(|_| code.to_string())?;
    let after = file.metadata().map_err(|_| code.to_string())?;
    if before.len() != after.len() || bytes.len() as u64 != after.len() { return fail(code); }
    let again = dir.symlink_metadata(relative).map_err(|_| code.to_string())?;
    if !again.is_file() || !cap_no_link(&again) { return fail(code); }
    Ok(bytes)
}
fn canonical(value: &Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(canonical).collect()),
        Value::Object(items) => Value::Object(items.iter().map(|(k,v)| (k.clone(), canonical(v))).collect::<BTreeMap<_,_>>().into_iter().collect()),
        _ => value.clone(),
    }
}
fn string<'a>(object: &'a Map<String, Value>, key: &str) -> Result<&'a str, String> { object.get(key).and_then(Value::as_str).filter(|v| !v.trim().is_empty()).ok_or_else(|| "codex_storyboard_operator_request_invalid".to_string()) }
fn valid_id(value: &str, max: usize) -> bool { !value.is_empty() && value.len() <= max && value.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') }
fn usage(value: &str) -> bool { matches!(value, "spatial_authority"|"pose_reference"|"face_identity"|"body_costume"|"prop_detail"|"style_only"|"lighting_only"|"negative_example") }
fn inspect_image(bytes: &[u8], expected: Option<&str>) -> Result<(u32,u32,String), String> {
    let format = image::guess_format(bytes).map_err(|_| "codex_storyboard_operator_image_invalid".to_string())?;
    let mime = match format { ImageFormat::Png => "image/png", ImageFormat::Jpeg => "image/jpeg", _ => return fail("codex_storyboard_operator_image_invalid") };
    if expected.is_some() && expected != Some(mime) { return fail("codex_storyboard_operator_image_invalid"); }
    let image = image::load_from_memory_with_format(bytes, format).map_err(|_| "codex_storyboard_operator_image_invalid".to_string())?;
    let (width,height) = image.dimensions(); if width == 0 || height == 0 { return fail("codex_storyboard_operator_image_invalid"); }
    Ok((width,height,mime.to_string()))
}
fn request_and_digest(package: &Dir, package_path: &Path) -> Result<(Value, String), String> {
    let bytes = stable_read(package, package_path, "request.json", "codex_storyboard_operator_request_invalid")?;
    let request: Value = serde_json::from_slice(&bytes).map_err(|_| "codex_storyboard_operator_request_invalid".to_string())?;
    let object = request.as_object().ok_or_else(|| "codex_storyboard_operator_request_invalid".to_string())?;
    let expected = ["schemaVersion","jobId","projectId","episodeId","shotId","provider","createdAt","prompt","references","acceptedImagePath","expectedOutput"];
    if object.len()!=expected.len() || expected.iter().any(|key| !object.contains_key(*key)) || object.get("schemaVersion").and_then(Value::as_u64)!=Some(1) || object.get("provider").and_then(Value::as_str)!=Some(PROVIDER) { return fail("codex_storyboard_operator_request_invalid"); }
    for key in ["jobId","projectId","episodeId","shotId"] { if !valid_id(string(object,key)?,96) { return fail("codex_storyboard_operator_request_invalid"); } }
    let prompt = object.get("prompt").and_then(Value::as_object).ok_or_else(|| "codex_storyboard_operator_request_invalid".to_string())?;
    if prompt.get("useCase").and_then(Value::as_str)!=Some("stylized-concept") || string(prompt,"primaryRequest").is_err() { return fail("codex_storyboard_operator_request_invalid"); }
    let refs = object.get("references").and_then(Value::as_array).filter(|items| !items.is_empty() && items.len()<=16).ok_or_else(|| "codex_storyboard_operator_request_invalid".to_string())?;
    let mut ids = std::collections::HashSet::new(); let mut spatial=false; let mut identity=false;
    for reference in refs {
        let r = reference.as_object().ok_or_else(|| "codex_storyboard_operator_request_invalid".to_string())?;
        let keys=["id","usage","instruction","relativePath","sha256","width","height","mimeType"];
        if r.len()!=keys.len() || keys.iter().any(|key| !r.contains_key(*key)) { return fail("codex_storyboard_operator_request_invalid"); }
        let id=string(r,"id")?; let u=string(r,"usage")?; let rel=string(r,"relativePath")?; let digest=string(r,"sha256")?; let mime=string(r,"mimeType")?;
        if !valid_id(id,64)||!ids.insert(id.to_string())||!usage(u)||!normal(rel)||digest.len()!=64||!digest.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()) { return fail("codex_storyboard_operator_request_invalid"); }
        let bytes=stable_read(package, package_path, rel, "codex_storyboard_operator_reference_invalid")?;
        let (w,h,actual)=inspect_image(&bytes, Some(mime))?;
        if sha(&bytes)!=digest || r.get("width").and_then(Value::as_u64)!=Some(w as u64) || r.get("height").and_then(Value::as_u64)!=Some(h as u64) || actual!=mime { return fail("codex_storyboard_operator_reference_invalid"); }
        spatial|=u=="spatial_authority"; identity|=u=="face_identity"||u=="body_costume";
    }
    if !spatial || !identity { return fail("codex_storyboard_operator_request_invalid"); }
    let bytes=serde_json::to_vec(&canonical(&request)).map_err(|_| "codex_storyboard_operator_request_invalid".to_string())?;
    Ok((request,sha(&bytes)))
}
fn output_dir(package: &Dir, package_path: &Path) -> Result<Dir,String> {
    match package.create_dir("outputs") { Ok(())=>{}, Err(e) if e.kind()==std::io::ErrorKind::AlreadyExists=>{}, Err(_)=>return fail("codex_storyboard_operator_publish_failed") }
    check_path_components(package_path,"outputs","codex_storyboard_operator_publish_failed")?;
    package.open_dir("outputs").map_err(|_| "codex_storyboard_operator_publish_failed".to_string())
}
fn exists(dir:&Dir,name:&str)->bool { dir.symlink_metadata(name).is_ok() }
fn temp_name(name:&str)->String { format!(".{name}.tmp-{}-{}",process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos()) }
fn publish(dir:&Dir,name:&str,bytes:&[u8], inject:bool)->Result<(),String>{
    if exists(dir,name) { return fail("codex_storyboard_operator_output_exists"); }
    let temp=temp_name(name); let mut opts=OpenOptions::new(); opts.write(true).create_new(true);
    let mut file=dir.open_with(&temp,&opts).map_err(|_|"codex_storyboard_operator_publish_failed".to_string())?;
    file.write_all(bytes).and_then(|_|file.sync_all()).map_err(|_|"codex_storyboard_operator_publish_failed".to_string())?; drop(file);
    if inject { let _=dir.remove_file(&temp); return fail("codex_storyboard_operator_publish_failed"); }
    let linked=dir.hard_link(&temp,dir,name); let _=dir.remove_file(&temp);
    match linked { Ok(())=>Ok(()), Err(_) if exists(dir,name)=>fail("codex_storyboard_operator_output_exists"), Err(_)=>fail("codex_storyboard_operator_publish_failed") }
}
fn compiled_prompt(request:&Value)->Result<String,String>{ let o=request.as_object().ok_or_else(||"codex_storyboard_operator_request_invalid".to_string())?; let refs=o.get("references").and_then(Value::as_array).ok_or_else(||"codex_storyboard_operator_request_invalid".to_string())?; let mut parts=Vec::new(); for (i,r) in refs.iter().enumerate(){let m=r.as_object().ok_or_else(||"codex_storyboard_operator_request_invalid".to_string())?;parts.push(format!("Picture {} [{}]: {}",i+1,string(m,"usage")?,string(m,"instruction")?));}parts.push(string(o.get("prompt").and_then(Value::as_object).ok_or_else(||"codex_storyboard_operator_request_invalid".to_string())?,"primaryRequest")?.to_string());Ok(parts.join("\n")) }
fn complete(package_argument:&str,candidate_path:&str)->Result<Value,String>{
    let package_path=fs::canonicalize(package_argument).map_err(|_|"codex_storyboard_operator_package_invalid".to_string())?;
    let package=open_dir(&package_path,"codex_storyboard_operator_package_invalid")?;
    let (request,request_digest)=request_and_digest(&package,&package_path)?;
    let source=fs::canonicalize(candidate_path).map_err(|_|"codex_storyboard_operator_candidate_invalid".to_string())?;
    let source_meta=fs::symlink_metadata(&source).map_err(|_|"codex_storyboard_operator_candidate_invalid".to_string())?;
    if !source_meta.is_file() || !no_link(&source_meta) { return fail("codex_storyboard_operator_candidate_invalid"); }
    let mut source_file=fs::File::open(&source).map_err(|_|"codex_storyboard_operator_candidate_invalid".to_string())?;
    let before=source_file.metadata().map_err(|_|"codex_storyboard_operator_candidate_invalid".to_string())?;
    let mut bytes=Vec::new(); source_file.read_to_end(&mut bytes).map_err(|_|"codex_storyboard_operator_candidate_invalid".to_string())?;
    let after=source_file.metadata().map_err(|_|"codex_storyboard_operator_candidate_invalid".to_string())?;
    if before.len()!=after.len() || bytes.len() as u64 != after.len() { return fail("codex_storyboard_operator_candidate_invalid"); }
    let (width,height,mime)=inspect_image(&bytes,Some("image/png"))?; let candidate_digest=sha(&bytes);
    let outputs=output_dir(&package,&package_path)?;
    let mut lock=OpenOptions::new();lock.write(true).create_new(true);let lock_file=outputs.open_with(".complete.lock",&lock).map_err(|_|"codex_storyboard_operator_busy".to_string())?;
    let operation=(|| -> Result<Value,String> {
    if exists(&outputs,"result.json") { return fail("codex_storyboard_operator_replay"); }
    if exists(&outputs,"candidate.png") { let current=stable_read(&outputs,&package_path.join("outputs"),"candidate.png","codex_storyboard_operator_publish_failed")?; let (w,h,m)=inspect_image(&current,Some("image/png"))?;if sha(&current)!=candidate_digest||w!=width||h!=height||m!=mime{return fail("codex_storyboard_operator_candidate_conflict");} } else { publish(&outputs,"candidate.png",&bytes,false)?; }
    let o=request.as_object().unwrap();let refs=o.get("references").and_then(Value::as_array).unwrap();let references:Vec<Value>=refs.iter().map(|r|json!({"id":r["id"],"sha256":r["sha256"]})).collect();
    let result=json!({"schemaVersion":1,"jobId":o["jobId"],"projectId":o["projectId"],"episodeId":o["episodeId"],"shotId":o["shotId"],"provider":PROVIDER,"requestDigest":request_digest,"referenceDigests":references,"generationMode":"codex_builtin_imagegen","finalPrompt":compiled_prompt(&request)?,"output":{"relativePath":"outputs/candidate.png","sha256":candidate_digest,"width":width,"height":height,"mimeType":"image/png"},"completedAt":"1970-01-01T00:00:00.000Z","state":"completed"});
    let result_bytes=serde_json::to_vec_pretty(&result).map_err(|_|"codex_storyboard_operator_publish_failed".to_string())?;
    let inject=env::var("NODE_ENV").ok().as_deref()==Some("test")&&env::var("CODEX_STORYBOARD_TEST_FAIL_RESULT_PUBLISH").ok().as_deref()==Some("1");
    publish(&outputs,"result.json",&result_bytes,inject)?;
    Ok(json!({"jobId":o["jobId"],"resultPath":package_path.join("outputs").join("result.json")}))
    })();
    drop(lock_file); let _=outputs.remove_file(".complete.lock"); operation
}
fn main(){let args:Vec<String>=env::args().collect();let result=if args.len()==6&&args[1]=="complete"&&args[2]=="--package"&&args[4]=="--candidate"{complete(&args[3],&args[5])}else{fail("codex_storyboard_operator_usage")};match result{Ok(value)=>println!("{}",value),Err(code)=>{eprintln!("{code}");process::exit(15)}}}

#[cfg(test)] mod tests { use super::*; #[test] fn rejects_relative_paths(){assert!(!normal("../escape.png"));assert!(!normal("/absolute.png"));} #[test] fn canonical_order_is_stable(){assert_eq!(canonical(&json!({"b":1,"a":2})).to_string(),"{\"a\":2,\"b\":1}");} }
