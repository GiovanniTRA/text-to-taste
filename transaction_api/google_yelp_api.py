import requests
import json
import pandas as pd

# Set the Google Places API key
google_places_key = '1234'

# Set the Yelp API key
yelp_api_key = 'XXXXXXX'  # Replace XXXXXXX with the Yelp API key

# Set headers for API requests
headers = {
    'accept': 'application/json',
    'Authorization': f'Bearer {yelp_api_key}',
}

def get_google_place_details(place_name):
    gmaps_place_url = f'https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input={place_name}&inputtype=textquery&key={google_places_key}'
    response = requests.get(gmaps_place_url, headers=headers)
    place = json.loads(response.text)
    try:
        place_id = place['candidates'][0]['place_id']
        gplace_url = f'https://maps.googleapis.com/maps/api/place/details/json?place_id={place_id}&key={google_places_key}'
        response = requests.get(gplace_url, headers=headers)
        gmaps_output = json.loads(response.text)
        maps_address = gmaps_output['result']['formatted_address']
        split_address = maps_address.split(',')
        state = ''.join(char for char in split_address[2] if char.isalpha())
        return split_address, state
    except Exception as e:
        return None, None

def get_yelp_preferences(place_name, split_address, state):
    url = f'https://api.yelp.com/v3/businesses/matches?name={place_name}&address1={split_address[0]}&city={split_address[1]}&state={state}&country=US&limit=3&match_threshold=default'
    response = requests.get(url, headers=headers)
    yelp_output = json.loads(response.text)
    try:
        if yelp_output.get('businesses'):
            yelp_id = yelp_output['businesses'][0]['id']
            url = f'https://api.yelp.com/v3/businesses/{yelp_id}'
            response = requests.get(url, headers=headers)
            yelp_business = json.loads(response.text)
            titles = [item['title'] for item in yelp_business['categories']]
            return ', '.join(titles)
    except Exception as e:
        return None

def main():
    # Replace 'my_transactions.xlsx' with the path to your transactions file (I have extracted it from the plaid database)
    excel_file_path = './my_transactions.xlsx'

    # Read the Excel file into a pandas DataFrame
    df = pd.read_excel(excel_file_path)

    # Assuming the fourth column is the column that contains the restaurant names indexed at 3 (0-indexed)
    restaurants = df.iloc[:, 3]

    preferences = []
    for place_name in restaurants:
        print(place_name)
        split_address, state = get_google_place_details(place_name)
        if split_address is not None and state is not None:
            yelp_preference = get_yelp_preferences(place_name, split_address, state)
            if yelp_preference:
                preferences.append(yelp_preference)

    # Create a new list by splitting strings with commas
    split_list = [item.strip() for sublist in preferences for item in sublist.split(',')]

    # Display the new list
    print(split_list)

if __name__ == "__main__":
    main()
