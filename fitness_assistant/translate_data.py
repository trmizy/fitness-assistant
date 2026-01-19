import os
import csv
import re
from pathlib import Path
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

# Configure Gemini
genai.configure(api_key=os.getenv('GOOGLE_API_KEY'))
model = genai.GenerativeModel('models/gemini-2.5-flash')

def extract_exercise_names(text):
    """Extract all exercise names (capitalized words/phrases) from text"""
    # Common patterns for exercise names
    patterns = [
        r'\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\s+[A-Z][a-z]+)?\b',  # Multi-word capitalized
        r'\b[A-Z]{2,}\b',  # All caps abbreviations
    ]
    names = set()
    for pattern in patterns:
        matches = re.findall(pattern, text)
        names.update(matches)
    return names

def translate_question_batch(questions, exercise_names):
    """Translate a batch of questions to Vietnamese, keeping exercise names in English"""
    
    # Create prompt for batch translation
    questions_text = "\n".join([f"{i+1}. {q}" for i, q in enumerate(questions)])
    exercise_list = ", ".join(sorted(exercise_names))
    
    prompt = f"""Translate the following fitness questions from English to Vietnamese.
IMPORTANT RULES:
1. Keep ALL exercise names in English (do NOT translate): {exercise_list}
2. Translate everything else to natural Vietnamese
3. Keep the numbering format
4. Preserve question marks and punctuation

Examples:
"What equipment do I need to perform the Face Pull exercise?" 
→ "Tôi cần thiết bị gì để thực hiện bài tập Face Pull?"

"Which body part does the Dumbbell Bench Press focus on?"
→ "Dumbbell Bench Press tập trung vào bộ phận cơ thể nào?"

Now translate these questions:
{questions_text}

Return ONLY the translated questions with their numbers, one per line."""

    response = model.generate_content(prompt)
    translated = response.text.strip()
    
    # Parse the response
    lines = [line.strip() for line in translated.split('\n') if line.strip()]
    results = []
    for line in lines:
        # Remove numbering
        match = re.match(r'^\d+\.\s*(.+)$', line)
        if match:
            results.append(match.group(1))
        else:
            results.append(line)
    
    return results

def translate_csv():
    input_file = Path("data/ground-truth-retrieval.csv")
    output_file = Path("data/ground-truth-retrieval-vi.csv")
    backup_file = Path("data/ground-truth-retrieval-backup.csv")
    
    print(f"Reading {input_file}...")
    
    # Read all data
    rows = []
    with open(input_file, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        rows = list(reader)
    
    print(f"Total rows: {len(rows)}")
    
    # Collect all exercise names from the dataset
    all_text = " ".join([row[1] for row in rows if len(row) > 1])
    exercise_names = extract_exercise_names(all_text)
    
    # Common exercise-related words to keep in English
    exercise_keywords = {
        'Push-Up', 'Pull-Up', 'Squat', 'Deadlift', 'Bench Press', 'Curl', 
        'Press', 'Row', 'Lunge', 'Plank', 'Crunch', 'Raise', 'Fly', 'Shrug',
        'TRX', 'Smith Machine', 'Cable', 'Dumbbell', 'Barbell', 'Kettlebell',
        'Machine', 'Band', 'Resistance Band', 'Medicine Ball'
    }
    exercise_names.update(exercise_keywords)
    
    print(f"Detected {len(exercise_names)} exercise-related terms")
    print("Starting translation in batches...")
    
    translated_rows = []
    batch_size = 50  # Process 50 questions at a time
    
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i+batch_size]
        questions = [row[1] for row in batch if len(row) > 1]
        
        if not questions:
            translated_rows.extend(batch)
            continue
        
        print(f"Translating batch {i//batch_size + 1}/{(len(rows)-1)//batch_size + 1}...")
        
        try:
            translations = translate_question_batch(questions, exercise_names)
            
            # Match translations with original rows
            trans_idx = 0
            for row in batch:
                if len(row) > 1:
                    if trans_idx < len(translations):
                        translated_rows.append([row[0], translations[trans_idx]])
                        trans_idx += 1
                    else:
                        translated_rows.append(row)
                else:
                    translated_rows.append(row)
        except Exception as e:
            print(f"Error in batch {i//batch_size + 1}: {e}")
            print("Keeping original text for this batch")
            translated_rows.extend(batch)
    
    # Backup original
    print(f"Creating backup at {backup_file}...")
    with open(backup_file, 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        writer.writerows(rows)
    
    # Write translated version
    print(f"Writing translated data to {output_file}...")
    with open(output_file, 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        writer.writerows(translated_rows)
    
    print("✓ Translation complete!")
    print(f"  Original: {input_file}")
    print(f"  Backup: {backup_file}")
    print(f"  Vietnamese: {output_file}")
    print("\nIf you want to replace the original file, run:")
    print(f"  Move-Item {output_file} {input_file} -Force")

if __name__ == "__main__":
    translate_csv()
