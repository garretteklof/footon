UPDATE training_workouts
SET raw_json = json_object(
  'workout_date', json_extract(raw_json, '$.workout_date'),
  'name', json_extract(raw_json, '$.name'),
  'description', json_extract(raw_json, '$.description'),
  'workout_status_text', json_extract(raw_json, '$.workout_status_text'),
  'is_race', CASE json_type(raw_json, '$.is_race')
    WHEN 'true' THEN json('true')
    WHEN 'false' THEN json('false')
    ELSE NULL
  END,
  'Activities', json(COALESCE((
    SELECT json_group_array(json_object(
      'activity_type_name', json_extract(activity.value, '$.activity_type_name'),
      'planned_amount', json_extract(activity.value, '$.planned_amount'),
      'planned_amount_type', json_extract(activity.value, '$.planned_amount_type')
    ))
    FROM json_each(training_workouts.raw_json, '$.Activities') AS activity
    WHERE activity.type = 'object'
  ), '[]'))
), normalized_json = json_object(
  'date', substr(json_extract(raw_json, '$.workout_date'), 1, 10),
  'name', json_extract(raw_json, '$.name'),
  'description', json_extract(raw_json, '$.description'),
  'status', CASE lower(trim(COALESCE(json_extract(raw_json, '$.workout_status_text'), '')))
    WHEN 'planned' THEN 'planned'
    WHEN 'completed' THEN 'completed'
    ELSE 'unknown'
  END,
  'isRace', CASE json_type(raw_json, '$.is_race')
    WHEN 'true' THEN json('true')
    WHEN 'false' THEN json('false')
    ELSE NULL
  END,
  'activities', json(COALESCE((
    SELECT json_group_array(json_object(
      'activityType', json_extract(activity.value, '$.activity_type_name'),
      'plannedAmount', json_extract(activity.value, '$.planned_amount'),
      'plannedAmountUnit', json_extract(activity.value, '$.planned_amount_type')
    ))
    FROM json_each(training_workouts.raw_json, '$.Activities') AS activity
    WHERE activity.type = 'object'
  ), '[]'))
)
WHERE provider = 'final-surge';
