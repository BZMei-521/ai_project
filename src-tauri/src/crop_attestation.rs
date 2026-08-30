pub fn verify_exact_crop_pixels(
    source_bytes: &[u8],
    candidate_bytes: &[u8],
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let invalid = "codex_storyboard_crop_pixels_mismatch";
    let source = image::load_from_memory(source_bytes)
        .map_err(|_| invalid.to_string())?
        .to_rgba8();
    let candidate = image::load_from_memory(candidate_bytes)
        .map_err(|_| invalid.to_string())?
        .to_rgba8();
    if candidate.dimensions() != (width, height)
        || x.checked_add(width).is_none_or(|right| right > source.width())
        || y.checked_add(height).is_none_or(|bottom| bottom > source.height())
    {
        return Err(invalid.to_string());
    }
    for row in 0..height {
        for column in 0..width {
            if source.get_pixel(x + column, y + row) != candidate.get_pixel(column, row) {
                return Err(invalid.to_string());
            }
        }
    }
    Ok(())
}
